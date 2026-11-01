/**
 * MC-140: avatar initials must not split a non-BMP character.
 *
 * Live defect this locks down: 3 of 120 needs_reply contacts in the mychef workspace carry an astral
 * character in the name and one starts with one. The old `part[0]` took a single UTF-16 code unit,
 * so the server wrote a lone high surrogate into the HTML while the RSC payload carried the escape —
 * React reported error #418 on /mychef/inbox at 1440x900 and 390x844 on build 581c5c7.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initials } from "@/lib/format";

const ROOT = process.cwd();

/** True if the string contains a surrogate code unit that is not part of a valid pair. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

test("plain names keep their two initials", () => {
  assert.equal(initials("Kirra"), "K");
  assert.equal(initials("Kirra van der Berg"), "KV");
  assert.equal(initials("  david   dandanell "), "DD");
});

test("a name that starts with an emoji yields a whole code point, not half of one", () => {
  const value = initials("\u{1F9A9} Kirra");
  assert.equal(value, "\u{1F9A9}K");
  assert.equal(hasLoneSurrogate(value), false);
  // The old implementation's result, reproduced here so the regression is unambiguous.
  const broken = "\u{1F9A9} Kirra".trim().split(/\s+/)[0][0];
  assert.equal(hasLoneSurrogate(broken), true);
});

test("two astral initials stay well formed", () => {
  const value = initials("\u{1F600} \u{1F680}");
  assert.equal(hasLoneSurrogate(value), false);
  assert.equal(value, "\u{1F600}\u{1F680}");
});

test("empty, blank and missing names fall back to a question mark, never to an empty avatar", () => {
  assert.equal(initials(null), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials(""), "?");
  assert.equal(initials("   "), "?");
});

test("a single emoji is a valid one-character initial", () => {
  const value = initials("\u{1F44D}");
  assert.equal(value, "\u{1F44D}");
  assert.equal(hasLoneSurrogate(value), false);
});

test("both avatar call sites use the shared helper", () => {
  for (const file of ["src/components/inbox/queue-pane.tsx", "src/components/inbox/desk-review.tsx"]) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.match(source, /import \{[^}]*initials[^}]*\} from "@\/lib\/format"/, `${file} must import initials`);
    assert.doesNotMatch(source, /function initials\(/, `${file} must not define its own initials`);
    assert.doesNotMatch(source, /part\[0\]/, `${file} must not index a code unit`);
  }
});
