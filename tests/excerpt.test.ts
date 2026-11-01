/**
 * MC-140 second site: previews must not cut a character in half.
 *
 * The old excerpt() ended with `flat.slice(0, length - 1)`, a UTF-16 index. If that index landed
 * between the two code units of an astral character the preview ended in a lone high surrogate, the
 * server HTML carried the raw unit, the RSC payload carried the escape, and React reported #418 —
 * exactly the MC-140 avatar defect, one component over. It renders live inbound text on
 * [workspace]/inbox, inbox/queue, evals, components/inbox/queue-pane and dashboard.
 *
 * Latent at measurement time (0 of 120 messages landed on a cut), which is why this file locks the
 * property over every length rather than only the length that broke once.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { excerpt } from "@/lib/format";

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

test("short text is returned whole, with whitespace flattened", () => {
  assert.equal(excerpt("Picking up six guests at 18:00", 160), "Picking up six guests at 18:00");
  assert.equal(excerpt("  two\n\nlines  ", 160), "two lines");
});

test("plain ASCII truncation is unchanged by the code-point fix", () => {
  const value = excerpt("x".repeat(200), 20);
  assert.equal(value, `${"x".repeat(19)}\u2026`);
  assert.equal(value.length, 20);
});

test("a cut that lands inside an emoji no longer emits half a character", () => {
  // 8 ASCII characters, then a 2-code-unit emoji, so the old cut at index 9 kept the high surrogate.
  const text = `${"a".repeat(8)}\u{1F9A9}${"b".repeat(40)}`;

  const broken = text.slice(0, 10 - 1).trimEnd();
  assert.equal(hasLoneSurrogate(broken), true, "the old implementation must reproduce the defect");

  const value = excerpt(text, 10);
  assert.equal(hasLoneSurrogate(value), false);
  assert.equal(value, `${"a".repeat(8)}\u{1F9A9}\u2026`);
});

test("every length over an astral-heavy string stays well formed and inside its budget", () => {
  const text = `\u{1F9A9}Viera Madjid \u{1F44B}\u{1F3FD} salam, mau tanya menu vegetarian untuk 12 tamu besok`;
  for (let length = 1; length <= 90; length += 1) {
    const value = excerpt(text, length);
    assert.equal(hasLoneSurrogate(value), false, `length ${length} produced a lone surrogate`);
    assert.ok(
      Array.from(value).length <= length,
      `length ${length} produced ${Array.from(value).length} characters`,
    );
    assert.ok(value === text || value.endsWith("\u2026"), `length ${length} lost its ellipsis`);
  }
});

test("a name that is only emoji survives truncation", () => {
  const value = excerpt("\u{1F9A9}\u{1F9A9}\u{1F9A9}\u{1F9A9}\u{1F9A9}", 3);
  assert.equal(hasLoneSurrogate(value), false);
  assert.equal(value, "\u{1F9A9}\u{1F9A9}\u2026");
});

test("excerpt is code-point based in source, not an index cut", () => {
  const source = readFileSync(join(ROOT, "src/lib/format.ts"), "utf8");
  const body = source.slice(source.indexOf("export function excerpt"));
  assert.match(body, /Array\.from\(flat\)/, "excerpt must slice code points");
  assert.doesNotMatch(body, /flat\.slice\(0,/, "excerpt must not slice by UTF-16 index");
});
