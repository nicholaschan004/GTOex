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

/**
 * Classes that mean two things at once.
 *
 * Tailwind names font sizes xs/sm/base/lg/xl, and it names a `text-{colour}`
 * utility after every colour in the theme. A colour called `base` therefore
 * makes it emit `.text-base` twice, once setting font-size and once setting
 * color. Neither rule wins, because they set different properties: both apply.
 * So `className="text-base"`, written by anyone who wanted 16px type, also
 * silently painted the text #0a0d0c, and that is what put near-black labels on
 * the action buttons at 1.38:1 against their own fill.
 *
 * Nothing else in the pipeline reports this. The class exists, so the check
 * above is satisfied; the CSS is valid, so the build is quiet; and the only
 * symptom is text you cannot read. Rather than banning a name, this looks for
 * the shape of the bug: one class selector setting both properties from two
 * different rules.
 */
const properties = new Map();
for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const name = selector.trim();
  // Single class selectors only. Anything compound is preflight or a
  // hand-written rule, and those set several properties on purpose.
  //
  // Escaped characters are folded to a plain one before the test rather than
  // allowed through it, so the colon in `.sm\:text-base` reads as part of the
  // name while the one in `.hover\:text-ink:hover` still reads as a pseudo
  // class. Getting this wrong silently narrows the check to unprefixed
  // classes, which is most of the way to not having it.
  const bare = name.replace(/\\./g, "_");
  if (!/^\.[^\s,:>+~[\]()]+$/.test(bare)) continue;
  const seen = properties.get(name) ?? { size: false, colour: false };
  if (/(^|;)\s*font-size\s*:/.test(body)) seen.size = true;
  if (/(^|;)\s*color\s*:/.test(body)) seen.colour = true;
  properties.set(name, seen);
}

const ambiguous = [...properties]
  .filter(([, seen]) => seen.size && seen.colour)
  .map(([name]) => name);

if (missing.length === 0 && ambiguous.length === 0) {
  console.log(`All ${candidates.size} classes used in src/ are present in the CSS.`);
  console.log(`No class sets both a font size and a colour.`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(`${missing.length} class(es) produced no CSS:\n`);
  for (const { token, file } of missing) console.error(`  ${token}  (${file})`);
  console.error("\nEither a typo, or a utility Tailwind does not generate.");
}

if (ambiguous.length > 0) {
  console.error(`\n${ambiguous.length} class(es) set both a font size and a colour:\n`);
  for (const name of ambiguous) console.error(`  ${name}`);
  console.error(
    "\nA theme colour shares its name with a font size, so Tailwind emitted the\n" +
      "utility twice and both rules apply. Rename the colour.",
  );
}

process.exit(1);
