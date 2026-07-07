#!/usr/bin/env node
/**
 * Converts // line comments to block docs or removes them.
 * Preserves eslint/ts/biome directives and existing block comments.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GLOBS = [
  "apps/desktop/src/**/*.{ts,tsx}",
  "apps/desktop/e2e/**/*.{ts,tsx}",
  "apps/desktop/*.ts",
  "apps/design-lab/src/**/*.{ts,tsx}",
  "apps/design-lab/*.ts",
  "packages/*/src/**/*.{ts,tsx}",
  "apps/desktop/src-tauri/src/**/*.rs",
];

const KEEP_LINE = /^\s*\/\/\s*(eslint|@ts-|biome-ignore|allow\(|deny\(|warn\(|clippy::)/;
const DIVIDER = /^\s*\/\/\s*[-=]{3,}/;
const TRIVIAL =
  /^\s*\/\/\s*(Per-file|Live refs|Warm the|Step \d|Mark the|Open |Click |Press |Wait |Navigate |Scroll |Type |Select |Close |Toggle |Verify |Check |Ensure |Load |Reload |Mock |Setup |Teardown )/i;

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.name === "node_modules" || ent.name === "target" || ent.name === "dist") continue;
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|rs)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function collectFiles() {
  const dirs = [
    "apps/desktop/src",
    "apps/desktop/e2e",
    "apps/design-lab/src",
    "packages/core/src",
    "packages/ui/src",
    "apps/desktop/src-tauri/src",
  ];
  const extra = [
    "apps/desktop/vite.config.ts",
    "apps/desktop/vitest.config.ts",
    "apps/desktop/vitest.setup.ts",
    "apps/desktop/playwright.config.ts",
    "apps/design-lab/vite.config.ts",
  ];
  const files = new Set(dirs.flatMap((d) => walk(path.join(ROOT, d))));
  for (const f of extra) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.add(p);
  }
  return [...files];
}

function stripCommentPrefix(line) {
  return line.replace(/^\s*\/\/\s?/, "").replace(/^\s*\/\/\s?$/, "");
}

function isCommentLine(line) {
  return /^\s*\/\//.test(line) && !KEEP_LINE.test(line);
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function nextNonBlank(lines, i) {
  for (let j = i; j < lines.length; j++) {
    if (!isBlank(lines[j])) return lines[j];
  }
  return null;
}

function isDocTarget(line) {
  if (!line) return false;
  return /^(export\s+)?(async\s+)?function\b/.test(line.trim()) ||
    /^export\s+(const|let|var|type|interface|enum|class)\b/.test(line.trim()) ||
    /^(const|let|var)\s+\w+/.test(line.trim()) ||
    /^#\[(derive|allow|serde)/.test(line.trim()) ||
    /^pub\s+(struct|enum|fn|async fn|const|type)/.test(line.trim()) ||
    /^struct\s+\w+/.test(line.trim()) ||
    /^fn\s+\w+/.test(line.trim());
}

function shouldKeepBlock(text) {
  const t = text.trim();
  if (!t) return false;
  if (t.length < 40 && !/[—–:;]/.test(t)) return false;
  return true;
}

function toJsDoc(lines, indent = "") {
  if (lines.length === 1) {
    return `${indent}/** ${lines[0].trim()} */`;
  }
  return [
    `${indent}/**`,
    ...lines.map((l) => `${indent} * ${l.trim() || ""}`.replace(/\s+$/, "")),
    `${indent} */`,
  ].join("\n");
}

function toRustDoc(lines, kind, indent = "") {
  const prefix = kind === "module" ? "//!" : "///";
  return lines.map((l) => `${indent}${prefix} ${l.trim()}`).join("\n");
}

function processTs(content) {
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  let seenCode = false;

  while (i < lines.length) {
    const line = lines[i];

    if (KEEP_LINE.test(line)) {
      out.push(line);
      i++;
      seenCode = true;
      continue;
    }

    if (DIVIDER.test(line)) {
      i++;
      continue;
    }

    if (TRIVIAL.test(line) && !lines[i + 1]?.trim().startsWith("//")) {
      i++;
      continue;
    }

    if (!isCommentLine(line)) {
      if (!isBlank(line)) seenCode = true;
      out.push(line);
      i++;
      continue;
    }

    const block = [];
    while (i < lines.length && (isCommentLine(lines[i]) || (block.length && isBlank(lines[i]) && isCommentLine(lines[i + 1] ?? "")))) {
      if (isCommentLine(lines[i])) block.push(stripCommentPrefix(lines[i]));
      else if (block.length) break;
      i++;
    }

    while (i < lines.length && isBlank(lines[i]) && !isCommentLine(lines[i + 1] ?? "")) {
      i++;
    }

    const next = nextNonBlank(lines, i);
    const keep = shouldKeepBlock(block.join("\n"));
    const atFileHead = !seenCode;
    const attach = isDocTarget(next);

    if (!keep) continue;

    if (atFileHead || attach) {
      const indent = next?.match(/^(\s*)/)?.[1] ?? "";
      out.push(toJsDoc(block, indent));
      if (out.length && i < lines.length) out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function processRs(content) {
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  let seenCode = false;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*\/\/[!\/]/.test(line) || /^\s*\/\*/.test(line)) {
      out.push(line);
      i++;
      if (!isBlank(line)) seenCode = true;
      continue;
    }

    if (DIVIDER.test(line)) {
      i++;
      continue;
    }

    if (!isCommentLine(line)) {
      if (!isBlank(line)) seenCode = true;
      out.push(line);
      i++;
      continue;
    }

    const block = [];
    while (i < lines.length && isCommentLine(lines[i])) {
      block.push(stripCommentPrefix(lines[i]));
      i++;
    }

    while (i < lines.length && isBlank(lines[i])) i++;

    const next = nextNonBlank(lines, i);
    const keep = shouldKeepBlock(block.join("\n"));
    const atFileHead = !seenCode;
    const attach = isDocTarget(next);

    if (!keep) continue;

    const indent = next?.match(/^(\s*)/)?.[1] ?? "";
    if (atFileHead) {
      out.push(toRustDoc(block, "module", ""));
    } else if (attach) {
      out.push(toRustDoc(block, "item", indent));
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function main() {
  const files = collectFiles();
  let changed = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    const next = file.endsWith(".rs") ? processRs(raw) : processTs(raw);
    if (next !== raw) {
      fs.writeFileSync(file, next.endsWith("\n") ? next : next + "\n");
      changed++;
    }
  }
  console.log(`Processed ${files.length} files, changed ${changed}.`);
}

main();
