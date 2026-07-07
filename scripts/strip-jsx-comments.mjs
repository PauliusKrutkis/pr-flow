#!/usr/bin/env node
/** Removes JSX block comments (curly-brace slash-star form). */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(tsx|jsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function collectFiles() {
  const dirs = ["apps/desktop/src"];
  return dirs.flatMap((d) => walk(path.join(ROOT, d)));
}

function stripJsxComments(content) {
  return content
    .replace(/[ \t]*\{\/\*[\s\S]*?\*\/\}[ \t]*\n?/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function main() {
  let changed = 0;
  for (const file of collectFiles()) {
    const raw = fs.readFileSync(file, "utf8");
    const next = stripJsxComments(raw);
    if (next !== raw) {
      fs.writeFileSync(file, next.endsWith("\n") ? next : next + "\n");
      changed++;
    }
  }
  console.log(`Updated ${changed} TSX files.`);
}

main();
