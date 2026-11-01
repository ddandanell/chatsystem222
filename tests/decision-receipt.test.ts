/**
 * UX-0211: a recorded decision must leave a receipt on screen.
 *
 * The regression is not a missing component — it is a discarded one. `reviewConversationAction()`
 * already returns `{ message, id }` (`mychef-actions.ts:163-164`: "Review recorded. Nothing was
 * sent." / "…and a Learning Queue card is pending. Nothing was sent."), and `submit()` read only
 * `result.error` and then called `goNext()`. So the one irreversible action on the desk left no
 * trace in the UI: no toast in the tree, no receipt, no id, and the operator was moved to the next
 * thread before they could see that anything had happened.
 *
 * These tests hold two things apart on purpose:
 *   - the wording, which is pure and is tested directly (`src/lib/decision-receipt.ts`);
 *   - the wiring, which is tested against the source text, because the desk is a client component
 *     that needs a browser to render. The server's own sentence is passed through verbatim: the
 *     client never writes "nothing was sent" on its own authority.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  receiptHeadline,
  receiptSentence,
  shortDecisionId,
  type RecordedDecision,
} from "@/lib/decision-receipt";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DECISIONS: RecordedDecision[] = ["accepted", "edited", "rejected", "escalated"];

test("every decision gets a headline that names it", () => {
  assert.equal(receiptHeadline("accepted"), "Accepted and recorded");
  assert.equal(receiptHeadline("edited"), "Correction recorded");
  assert.equal(receiptHeadline("rejected"), "Rejected and recorded");
  assert.equal(receiptHeadline("escalated"), "Escalated and recorded");
});

test("no headline claims anything was sent, delivered or replied to", () => {
  for (const decision of DECISIONS) {
    assert.doesNotMatch(receiptHeadline(decision), /\b(sent|delivered|replied|message[sd]?)\b/i);
  }
});

test("the decision id is shortened for display and never invented", () => {
  assert.equal(shortDecisionId("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"), "aaaaaaaa");
  assert.equal(shortDecisionId("  bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb  "), "bbbbbbbb");
  assert.equal(shortDecisionId(undefined), null);
  assert.equal(shortDecisionId(null), null);
  assert.equal(shortDecisionId(""), null);
  assert.equal(shortDecisionId("abc"), null);
});

test("the server's sentence is passed through verbatim, both branches", () => {
  const recorded = "Review recorded. Nothing was sent.";
  const queued =
    "Review recorded and a Learning Queue card is pending. Nothing was sent.";
  assert.equal(receiptSentence(recorded), recorded);
  assert.equal(receiptSentence(queued), queued);
  assert.equal(receiptSentence(`  ${recorded}  `), recorded);
});

test("with no sentence from the server the receipt says only that it was recorded", () => {
  // The client may not invent the "nothing was sent" half: only the write knows it.
  assert.equal(receiptSentence(undefined), "Recorded.");
  assert.equal(receiptSentence(null), "Recorded.");
  assert.equal(receiptSentence("   "), "Recorded.");
  assert.doesNotMatch(receiptSentence(undefined), /sent/i);
});

test("the action still returns the receipt the desk now keeps", () => {
  const actions = read("src/app/[workspace]/inbox/mychef-actions.ts");
  assert.match(actions, /export type ActionState = \{ error\?: string; message\?: string; id\?: string \}/);
  assert.match(actions, /queued\s*\n?\s*\? "Review recorded and a Learning Queue card is pending\. Nothing was sent\."/);
  assert.match(actions, /: "Review recorded\. Nothing was sent\.",/);
  assert.match(actions, /id: saved\.id,/);
});

test("the desk keeps what the action returned instead of navigating past it", () => {
  const desk = read("src/components/inbox/desk-review.tsx");
  assert.match(desk, /setReceipt\(\{\s*\n\s*headline: receiptHeadline\(human\),/);
  assert.match(desk, /message: receiptSentence\(result\?\.message\),/);
  assert.match(desk, /id: shortDecisionId\(result\?\.id\),/);
  // The success path must not call goNext(); only the receipt's own button does.
  const submit = desk.slice(desk.indexOf("function submit("), desk.indexOf("function regenerate("));
  assert.doesNotMatch(submit, /goNext\(\)/);
  assert.match(desk, /<Button type="button" onClick=\{goNext\}>\s*Next conversation/);
});

test("the receipt is announced, focusable, and readable after the navigation is refused", () => {
  const desk = read("src/components/inbox/desk-review.tsx");
  assert.match(desk, /role="status"/);
  assert.match(desk, /aria-live="polite"/);
  assert.match(desk, /data-slot="decision-receipt"/);
  assert.match(desk, /tabIndex=\{-1\}/);
  assert.match(desk, /if \(receipt\) receiptRef\.current\?\.focus\(\);/);
});

test("a recorded thread cannot be decided twice from the desk", () => {
  const desk = read("src/components/inbox/desk-review.tsx");
  assert.match(desk, /function submit\(decision: "accepted" \| "edited" \| "escalated"\) \{\s*\n\s*\/\/[^\n]*\n\s*if \(receipt\) return;/);
  assert.match(desk, /function onKey\(event: KeyboardEvent\) \{\s*\n\s*if \(receipt\) return;/);
  assert.match(desk, /readOnly=\{Boolean\(receipt\)\}/);
  // The five action buttons are removed once the receipt is up, not merely disabled.
  assert.match(desk, /\{receipt \? null : \(/);
});

test("the receipt clears when a different thread is opened", () => {
  const desk = read("src/components/inbox/desk-review.tsx").replace(/\s+/g, " ");
  // Same reset effect that clears the draft, the tab and the error when the thread changes.
  assert.match(desk, /setRemember\(true\); setTagDraft\(conversation\.tags\.join\(/, "reset effect not found");
  assert.match(desk, /setReceipt\(null\); \}, \[conversation\.id,/);
});
