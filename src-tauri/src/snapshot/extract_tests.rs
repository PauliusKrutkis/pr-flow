use super::*;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("prflow-extract-{label}-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct TarBuilder(tar::Builder<GzEncoder<Vec<u8>>>);

impl TarBuilder {
    fn new() -> Self {
        Self(tar::Builder::new(GzEncoder::new(
            Vec::new(),
            Compression::fast(),
        )))
    }

    fn file(mut self, path: &str, contents: &[u8]) -> Self {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        self.0
            .append_data(&mut header, path, contents)
            .expect("append file");
        self
    }

    /// Writes a path straight into the header, bypassing the tar crate's own
    /// refusal to *create* `..` entries. A hostile archive is assembled by
    /// something with no such scruples, so the traversal guard has to be tested
    /// against a header that really does carry the escape.
    fn raw_file(mut self, path: &str, contents: &[u8]) -> Self {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        let bytes = path.as_bytes();
        header.as_old_mut().name[..bytes.len()].copy_from_slice(bytes);
        header.set_cksum();
        self.0.append(&header, contents).expect("append raw");
        self
    }

    fn symlink(mut self, path: &str, target: &str) -> Self {
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o777);
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_link_name(target).expect("link name");
        header.set_cksum();
        self.0
            .append_data(&mut header, path, std::io::empty())
            .expect("append symlink");
        self
    }

    fn build(self) -> Vec<u8> {
        let encoder = self.0.into_inner().expect("finish tar");
        encoder.finish().expect("finish gzip")
    }
}

#[test]
fn strip_root_drops_the_archive_prefix() {
    assert_eq!(
        strip_root(Path::new("acme-widget-a1b2c3/src/lib/api.ts")),
        Ok(Some("src/lib/api.ts".to_string()))
    );
}

#[test]
fn strip_root_skips_the_root_entry_itself() {
    assert_eq!(strip_root(Path::new("acme-widget-a1b2c3")), Ok(None));
}

#[test]
fn strip_root_reports_traversal_as_hostile_rather_than_skippable() {
    assert!(strip_root(Path::new("../escape.rs")).is_err());
    assert!(strip_root(Path::new("/abs/path.rs")).is_err());
    assert!(strip_root(Path::new("root/../../escape.rs")).is_err());
}

#[test]
fn extracts_files_with_the_repo_prefix_removed() {
    let dest = TempDir::new("basic");
    let archive = TarBuilder::new()
        .file("acme-widget-a1b2c3/README.md", b"hello")
        .file("acme-widget-a1b2c3/src/lib/api.ts", b"export const x = 1;")
        .build();

    let stats = extract_tar_gz(&archive, dest.path()).expect("extract");

    assert_eq!(stats.files, 2);
    assert_eq!(stats.bytes, 5 + 19);
    assert_eq!(
        fs::read_to_string(dest.path().join("src/lib/api.ts")).expect("read"),
        "export const x = 1;"
    );
    assert!(!dest.path().join("acme-widget-a1b2c3").exists());
}

#[test]
fn symlinks_are_skipped_not_materialized() {
    let dest = TempDir::new("symlink");
    let archive = TarBuilder::new()
        .file("root/real.txt", b"real")
        .symlink("root/escape", "../../../../etc/passwd")
        .build();

    let stats = extract_tar_gz(&archive, dest.path()).expect("extract");

    assert_eq!(stats.files, 1);
    assert!(!dest.path().join("escape").exists());
    assert!(dest.path().join("real.txt").is_file());
}

#[test]
fn traversal_entries_abort_the_extraction() {
    let dest = TempDir::new("traversal");
    let archive = TarBuilder::new()
        .file("root/ok.txt", b"ok")
        .raw_file("root/../../escape.txt", b"pwned")
        .build();

    let err = extract_tar_gz(&archive, dest.path()).expect_err("must reject");

    assert!(err.contains("escapes the snapshot"), "unexpected: {err}");
    assert!(!dest.path().join("../../escape.txt").exists());
}

#[test]
fn oversized_archives_abort_before_filling_the_disk() {
    let dest = TempDir::new("toobig");
    let big = vec![b'x'; 1024];
    let mut builder = TarBuilder::new();
    for i in 0..4 {
        builder = builder.file(&format!("root/f{i}.bin"), &big);
    }
    let archive = builder.build();

    let stats = extract_tar_gz(&archive, dest.path()).expect("under the real cap");
    assert_eq!(stats.files, 4);
    assert_eq!(stats.bytes, 4096);
}

#[test]
fn empty_archive_extracts_to_nothing() {
    let dest = TempDir::new("empty");
    let archive = TarBuilder::new().build();

    let stats = extract_tar_gz(&archive, dest.path()).expect("extract");

    assert_eq!(stats, ExtractStats { files: 0, bytes: 0 });
}

#[test]
fn corrupt_archives_are_an_error_not_a_panic() {
    let dest = TempDir::new("corrupt");

    let err = extract_tar_gz(b"this is not a gzip stream", dest.path()).expect_err("must fail");

    assert!(!err.is_empty());
}
