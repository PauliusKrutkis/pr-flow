//! Repo snapshots: the file tree at a PR's head SHA, downloaded once as an
//! archive and extracted into the cache dir so full-file context is a local
//! read instead of a request per file (BACKLOG §9, layer 1).
//!
//! No git operations — an archive is one HTTP GET, keyed by commit SHA like
//! every other cache in the app. This module owns only the on-disk half; the
//! fetch/extract service arrives with the command that drives it.

pub(crate) mod store;
