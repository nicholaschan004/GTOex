#!/usr/bin/env node
/**
 * Fails if a Tailwind class used in src/ produced no CSS.
 *
 * Tailwind generates only what it finds, and a class it does not recognise is
 * not an error anywhere in the pipeline: no build warning, no runtime warning,
 * no visual clue beyond the styling quietly not happening. A typo like
 * `bg-flet`, or a custom colour that was renamed in the theme, therefore ships.
 *
 * Run against a fresh build. Anything reported here is either a typo or a
 * class that needs an inline style instead.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = "src";
const DIST = "dist/assets";

/** Classes that legitimately never reach the stylesheet. */
const IGNORED = new Set(["group", "peer", "sr-only", "dark", "light"]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function cssEscape(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

const sources = walk(SRC).filter(
  (f) => [".tsx", ".ts"].includes(extname(f)) && !f.includes(".test."),
);

// Only literal strings in className / cn(...) positions. Anything interpolated
// is skipped rather than guessed at.
const candidates = new Map();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)) {
    collect(match[1], file);
  }
  for (const match of text.matchAll(/(?:cn|clsx)\(([\s\S]*?)\)/g)) {
    for (const literal of match[1].matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)`/g)) {
      collect(literal[1] ?? literal[2] ?? literal[3], file);
    }
  }
}

function collect(blob, file) {
  if (!blob) return;
  for (const raw of blob.split(/\s+/)) {
    const token = raw.trim();
    if (!token || token.includes("$") || token.includes("{")) continue;
    if (IGNORED.has(token)) continue;
    if (!candidates.has(token)) candidates.set(token, file);
  }
}

let css = "";
for (const file of readdirSync(DIST)) {
  if (extname(file) === ".css") css += readFileSync(join(DIST, file), "utf8");
}
if (!css) {
  console.error("No built CSS found. Run `npm run build` first.");
  process.exit(2);
}

const missing = [];
for (const [token, file] of candidates) {
  if (!css.includes(`.${cssEscape(token)}`)) missing.push({ token, file });
}

if (missing.length === 0) {
  console.log(`All ${candidates.size} classes used in src/ are present in the CSS.`);
  process.exit(0);
}

console.error(`${missing.length} class(es) produced no CSS:\n`);
for (const { token, file } of missing) console.error(`  ${token}  (${file})`);
console.error("\nEither a typo, or a utility Tailwind does not generate.");
process.exit(1);
