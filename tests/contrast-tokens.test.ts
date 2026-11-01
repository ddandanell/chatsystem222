/**
 * UX-0201 / UX-0202: the focus ring and a field's edge must clear 3:1 (WCAG 1.4.11).
 *
 * Measured on the tokens themselves, not on a written-down number: this file parses
 * `src/app/globals.css`, converts OKLCH -> sRGB -> relative luminance, and composites the ring at the
 * alpha the code actually paints it with. If a later edit moves a token, this test recomputes
 * instead of trusting the comment above it.
 *
 * What the UX Auditor measured on the shipped build (round-3 production pass):
 *   focus ring  --ring oklch(0.708 0 0) at 50% -> 1.52:1 on the page   (needs 3:1)
 *   field edge  --input oklch(0.922 0 0)       -> 1.21:1 on --background (needs 3:1)
 *
 * No database, no network, no browser.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

type Triple = [number, number, number];
type Srgb8 = Triple;

function token(name: string): Triple {
  const match = root.match(new RegExp(`${name}:\\s*oklch\\(([^)]+)\\)`));
  assert.ok(match, `${name} must be an oklch() token in :root`);
  const [l, c, h] = match[1].trim().split(/\s+/).map(Number);
  return [l, c, h];
}

function oklchToLinear([L, C, H]: Triple): Triple {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function srgb8([l, c, h]: Triple): Srgb8 {
  return oklchToLinear([l, c, h]).map((v) => Math.round(toSrgb(v) * 255)) as Srgb8;
}

function luminance(rgb: Srgb8): number {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CSS composites a translucent colour in gamma-encoded sRGB; so does this. */
function over(fg: Srgb8, bg: Srgb8, alpha: number): Srgb8 {
  return fg.map((v, i) => Math.round(alpha * v + (1 - alpha) * bg[i])) as Srgb8;
}

function contrast(a: Srgb8, b: Srgb8): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function ratio(fgToken: string, bgToken: string, alpha = 1): number {
  const bg = srgb8(token(bgToken));
  return contrast(over(srgb8(token(fgToken)), bg, alpha), bg);
}

/** The alpha the ring is painted with: the base layer + every focus-visible ring utility. */
function ringAlpha(): number {
  const base = css.match(/outline-ring\/(\d+)/);
  assert.ok(base, "the base layer must paint the outline from --ring at an explicit alpha");
  return Number(base[1]) / 100;
}

const SURFACES = [
  "--background",
  "--card",
  "--popover",
  "--muted",
  "--secondary",
  "--accent",
] as const;

test("the focus ring clears 3:1 on every surface it can be painted over", () => {
  const alpha = ringAlpha();
  for (const surface of SURFACES) {
    const value = ratio("--ring", surface, alpha);
    assert.ok(
      value >= 3,
      `--ring at ${alpha} on ${surface} is ${value.toFixed(2)}:1, below the 3:1 floor`,
    );
  }
});

test("every focus ring utility uses the alpha this test assumed", () => {
  // If a component switched to ring-ring/30 the ring would be lighter than the number measured in
  // the previous test, so the assumption is pinned rather than described.
  const expected = `${Math.round(ringAlpha() * 100)}`;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        for (const match of readFileSync(full, "utf8").matchAll(/ring-ring\/(\d+)/g)) {
          if (match[1] !== expected) offenders.push(`${full} (/${match[1]})`);
        }
      }
    }
  };
  walk(join(ROOT, "src"));
  assert.deepEqual(offenders, [], `focus rings must all paint at /${expected}`);
});

test("a field's edge clears 3:1 on the page and on a card", () => {
  for (const surface of ["--background", "--card", "--muted"] as const) {
    const value = ratio("--input", surface);
    assert.ok(
      value >= 3,
      `--input on ${surface} is ${value.toFixed(2)}:1, below the 3:1 floor for a control boundary`,
    );
  }
});

test("text tokens still clear 4.5:1 — the ring fix must not trade one failure for another", () => {
  const pairs: [string, string][] = [
    ["--foreground", "--background"],
    ["--foreground", "--card"],
    ["--card-foreground", "--card"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--card"],
    ["--popover-foreground", "--popover"],
    ["--primary-foreground", "--primary"],
    ["--secondary-foreground", "--secondary"],
    ["--accent-foreground", "--accent"],
  ];
  for (const [fg, bg] of pairs) {
    const value = ratio(fg, bg);
    assert.ok(value >= 4.5, `${fg} on ${bg} is ${value.toFixed(2)}:1, below 4.5:1`);
  }
});

test("the values this change replaced would fail — the test is not vacuous", () => {
  const before = {
    ring: [0.708, 0, 0] as Triple,
    input: [0.922, 0, 0] as Triple,
  };
  const alpha = ringAlpha();
  const bg = srgb8(token("--background"));
  const card = srgb8(token("--card"));
  assert.ok(
    contrast(over(srgb8(before.ring), bg, alpha), bg) < 3,
    "the old ring must still measure below 3:1",
  );
  assert.ok(contrast(srgb8(before.input), bg) < 3, "the old field edge must still be below 3:1");
  assert.ok(contrast(srgb8(before.input), card) < 3);
});
