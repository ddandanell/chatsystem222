/**
 * B4: one theme, no dead dark mode.
 *
 * The `.dark` block and the 46 `dark:` classes were never reachable — nothing ever added the class,
 * and no `prefers-color-scheme` rule exists — so they were 33 declarations and 46 utilities that
 * looked like a supported second theme and were not. Deleting them is only safe while they stay
 * deleted, which is what this file is for. It also pins the six rows the UX Auditor pre-registered
 * in `round-3-ux-production-intake-2026-11-01.md` §3, so a later "small" token edit cannot quietly
 * move the contrast baseline.
 *
 * No database, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CSS = join(ROOT, "src/app/globals.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(ROOT, "src"));
const css = readFileSync(CSS, "utf8");
const DECLARATION = /^\s*(--[A-Za-z0-9-]+)\s*:/gm;
const declarations = [...css.matchAll(DECLARATION)].map((match) => match[1]);

test("no dark: utility survives anywhere in src", () => {
  const offenders = files
    .map((file) => ({ file, hits: (readFileSync(file, "utf8").match(/dark:/g) ?? []).length }))
    .filter((entry) => entry.hits > 0)
    .map((entry) => `${entry.file} (${entry.hits})`);
  assert.deepEqual(offenders, [], "dark: classes have no activator and must not come back");
});

test("the custom variant and the .dark block are gone", () => {
  assert.equal((css.match(/@custom-variant\s+dark/g) ?? []).length, 0);
  assert.equal((css.match(/^\.dark\b/gm) ?? []).length, 0, "no .dark selector block");
});

test("77 declarations over 77 distinct names — the pre-registered after-state", () => {
  // 110 before (43 @theme + 34 :root + 33 .dark); .dark contributed 0 new names, so deleting it
  // removes declarations, not names. A gate that reports 44 has counted declarations as names.
  assert.equal(declarations.length, 77);
  assert.equal(new Set(declarations).size, 77);
});

test("globals.css is smaller than the 5,238 bytes it replaced", () => {
  const bytes = Buffer.byteLength(css, "utf8");
  assert.ok(bytes < 5238, `expected < 5238 bytes, got ${bytes}`);
});

test("the contrast baseline tokens are exactly where they were", () => {
  // body #fcfaf6, card #ffffff, divider #e5e5e5, chip text #685b53 — the values the re-check fails
  // on if they move.
  //
  // --input moved on purpose in UX-0202: #e5e5e5 was 1.21:1 on the page, below the 3:1 a control
  // boundary needs, so the field edge is now #8c847f (3.51:1). --border deliberately did not move;
  // --input is the token a field is drawn with (border-input in input/textarea/select/checkbox),
  // --border is the divider. tests/contrast-tokens.test.ts recomputes both from this file.
  const anchors: [string, string][] = [
    ["--background", "oklch(0.985 0.006 95)"],
    ["--card", "oklch(0.997 0.003 95)"],
    ["--border", "oklch(0.922 0 0)"],
    ["--input", "oklch(0.62 0.012 55)"],
    ["--muted-foreground", "oklch(0.48 0.02 55)"],
  ];
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  for (const [token, value] of anchors) {
    assert.ok(
      root.includes(`${token}: ${value};`),
      `${token} must stay ${value} (found a different value in :root)`,
    );
  }
});
