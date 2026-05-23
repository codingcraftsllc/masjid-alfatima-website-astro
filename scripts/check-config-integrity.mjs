/**
 * Config integrity guard.
 *
 * Detects tampering / obfuscated-code injection in the executable config
 * files that the toolchain auto-loads and runs (astro, ...). It runs on
 * `predev` / `prebuild` / `prestart` / `prepreview`, so a poisoned config
 * halts the command instead of silently executing the payload.
 *
 * IMPORTANT: every target file is read as TEXT only. This script must never
 * `import()` or `require()` a config under inspection — loading it would run
 * the very payload it exists to catch.
 *
 * Two independent checks:
 *   1. Heuristic scan — obfuscation signatures + abnormally long lines.
 *   2. Hash pinning   — SHA-256 of the known-good content for stable files.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Config files the toolchain auto-loads and executes.
const SCANNED = ["astro.config.mjs"];

// SHA-256 of the newline-normalised, known-good content of the most stable,
// most-targeted files. A legitimate edit fails the build and prints the new
// hash below — updating it is then an intentional, reviewable step.
const PINNED = {
  "astro.config.mjs":
    "7b7715b9de2d5424e729e8b4b72eea5b068bdf9f93e0613969da7e854b94e5ba",
};

// Obfuscation / injection signatures.
const SIGNATURES = [
  ["String.fromCharCode", /String\.fromCharCode/],
  ["createRequire", /\bcreateRequire\b/],
  ["eval(", /\beval\s*\(/],
  ["Function constructor", /\bFunction\s*\(/],
  ["atob(", /\batob\s*\(/],
  ["global[] indexing", /global\s*\[/],
  ["_$_ obfuscator marker", /_\$_/],
  ["dense \\x hex escapes", /(?:\\x[0-9a-fA-F]{2}){6,}/],
];

const MAX_LINE = 300;

const normalise = (t) => t.replace(/\r\n/g, "\n");
const problems = [];

for (const name of SCANNED) {
  let raw;
  try {
    raw = readFileSync(join(projectRoot, name), "utf8");
  } catch {
    continue; // not present in this project — skip
  }
  const text = normalise(raw);

  for (const [label, re] of SIGNATURES) {
    if (re.test(text)) {
      problems.push(`${name}: matches injection signature [${label}]`);
    }
  }

  text.split("\n").forEach((line, i) => {
    if (line.length > MAX_LINE) {
      problems.push(
        `${name}: line ${i + 1} is ${line.length} chars ` +
          `(limit ${MAX_LINE}) — likely an obfuscated payload`,
      );
    }
  });

  const expected = PINNED[name];
  if (expected) {
    const actual = createHash("sha256").update(text).digest("hex");
    if (actual !== expected) {
      problems.push(
        `${name}: SHA-256 mismatch\n` +
          `      expected ${expected}\n` +
          `      actual   ${actual}\n` +
          `      If this change is intentional, update PINNED in ` +
          `scripts/check-config-integrity.mjs with the actual hash.`,
      );
    }
  }
}

if (problems.length > 0) {
  const RED = "\x1b[31m";
  const YEL = "\x1b[33m";
  const RST = "\x1b[0m";
  console.error(`${RED}✘ Config integrity check FAILED${RST}`);
  for (const p of problems) console.error(`${RED}  • ${p}${RST}`);
  console.error(
    `${YEL}Command halted — a config file may have been tampered with. ` +
      `Review the diff before continuing.${RST}`,
  );
  process.exit(1);
}

console.log("✔ Config integrity check passed");
