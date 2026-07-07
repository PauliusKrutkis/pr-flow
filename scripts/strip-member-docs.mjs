#!/usr/bin/env node
/**
 * Removes property-level JSDoc inside interfaces/types and docs before
 * const/let/var in function bodies. File headers and function docs are kept.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) {
    return acc;
  }
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.name === "node_modules" || ent.name === "dist") {
      continue;
    }
    if (ent.isDirectory()) {
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function collectFiles() {
  const dirs = [
    "apps/desktop/src",
    "apps/desktop/e2e",
    "packages/core/src",
    "packages/ui/src",
  ];
  return dirs.flatMap((d) => walk(path.join(ROOT, d)));
}

function blockEnd(lines, start) {
  for (let e = start; e < lines.length; e++) {
    if (/\*\//.test(lines[e])) {
      return e;
    }
  }
  return start;
}

function isPropertyLine(line) {
  const trimmed = line.trim();
  if (/^[A-Za-z_]\w*\s*\(/.test(trimmed)) {
    return false;
  }
  return /^[ \t]{2,}[A-Za-z_]\w*(?:\?)?: /.test(line);
}

function isStateLine(line) {
  return /^[ \t]{2,}(const|let|var)\s/.test(line);
}

function stripMemberDocs(content) {
  const lines = content.split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!/^[ \t]{2,}\/\*\*/.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    const start = i;
    const end = blockEnd(lines, start);

    let j = end + 1;
    while (j < lines.length && lines[j].trim() === "") {
      j++;
    }
    const next = lines[j] ?? "";

    if (isPropertyLine(next) || isStateLine(next)) {
      i = end + 1;
      continue;
    }

    for (let k = start; k <= end; k++) {
      out.push(lines[k]);
    }
    i = end + 1;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function main() {
  let changed = 0;
  for (const file of collectFiles()) {
    const raw = fs.readFileSync(file, "utf8");
    const next = stripMemberDocs(raw);
    if (next !== raw) {
      fs.writeFileSync(file, next.endsWith("\n") ? next : next + "\n");
      changed++;
    }
  }
  console.log(`Updated ${changed} files.`);
}

main();
