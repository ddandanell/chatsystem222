/**
 * CS-001 (P0): "decided" belongs to the latest turn, not to the conversation.
 *
 * The defect, in one sentence: a `decision_records` row was treated as a permanent property of the
 * conversation, so once a thread was reviewed the queue dropped it and every draft/review path
 * refused it — including after the guest wrote again. These tests pin the definition and pin that
 * the shipped SQL actually uses it, because a helper nobody calls would pass every case below and
 * change nothing in production.
 *
 * No database, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPEN_TURN_DECISION_PREDICATE,
  isDecided,
  turnState,
} from "@/lib/turn-state";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const T0 = "2026-11-01T09:00:00.000Z";
const T1 = "2026-11-01T10:00:00.000Z";

test("no decision at all is open", () => {
  assert.equal(turnState({ lastInboundAt: T1, lastDecisionAt: null }), "open");
  assert.equal(turnState({ lastInboundAt: null, lastDecisionAt: null }), "open");
});

test("a decision after the newest inbound is decided", () => {
  assert.equal(turnState({ lastInboundAt: T0, lastDecisionAt: T1 }), "decided");
});

test("an inbound newer than the decision re-opens the turn — this is the CS-001 fix", () => {
  assert.equal(turnState({ lastInboundAt: T1, lastDecisionAt: T0 }), "open");
  assert.equal(isDecided({ lastInboundAt: T1, lastDecisionAt: T0 }), false);
});

test("equal timestamps are decided: the decision was written for that message", () => {
  assert.equal(turnState({ lastInboundAt: T0, lastDecisionAt: T0 }), "decided");
});

test("a decision on a thread with no inbound stays decided (probe rows are not resurrected)", () => {
  assert.equal(turnState({ lastInboundAt: null, lastDecisionAt: T0 }), "decided");
});

test("status is not part of the definition — the queue gate stays in the queue query", () => {
  // The guard must not refuse a thread the desk is showing, so `turnState` takes no status input.
  assert.equal(turnState({ lastInboundAt: T1, lastDecisionAt: T0 }), "open");
  assert.equal(OPEN_TURN_DECISION_PREDICATE.includes("status"), false);
});

test("null/undefined timestamps and Date objects behave the same as ISO strings", () => {
  assert.equal(turnState({ lastInboundAt: new Date(T1), lastDecisionAt: new Date(T0) }), "open");
  assert.equal(turnState({ lastInboundAt: undefined, lastDecisionAt: new Date(T0) }), "decided");
  assert.equal(turnState({ lastInboundAt: T1, lastDecisionAt: undefined }), "open");
  // An unparseable stamp is treated as absent, not as "now" and not as "forever".
  assert.equal(turnState({ lastInboundAt: T1, lastDecisionAt: "not a date" }), "open");
});

test("the predicate is turn-bounded, workspace-bound and alias-bound", () => {
  assert.match(OPEN_TURN_DECISION_PREDICATE, /d\.created_at >= coalesce\(/);
  assert.match(OPEN_TURN_DECISION_PREDICATE, /'-infinity'::timestamptz/);
  assert.match(OPEN_TURN_DECISION_PREDICATE, /d\.workspace_id = c\.workspace_id/);
  assert.match(OPEN_TURN_DECISION_PREDICATE, /m\.direction = 'inbound'/);
  assert.match(OPEN_TURN_DECISION_PREDICATE, /d\.conversation_id = c\.id/);
  // A predicate that lost its time bound is exactly the shipped defect.
  assert.doesNotMatch(
    OPEN_TURN_DECISION_PREDICATE,
    /not exists \(\s*select 1 from mychef_inbox\.decision_records d\s*where d\.workspace_id = c\.workspace_id and d\.conversation_id = c\.id\s*\)/,
  );
});

test("every conversation list and count uses the one predicate", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(store, /import \{ OPEN_TURN_DECISION_PREDICATE, turnState \} from "@\/lib\/turn-state"/);
  // 1 dashboard count + 2 listInbox queries + 2 listDeskQueue queries + the conversation-keyed
  // decision lookup the desk uses, so a re-opened thread shows the thread and not the ledger view.
  const used = store.split("and ${OPEN_TURN_DECISION_PREDICATE}").length - 1;
  assert.equal(used, 6, "every open/decided test must splice the one constant");
  // No hand-written copy of the old, unbounded guard survives anywhere in the store.
  assert.doesNotMatch(
    store,
    /not exists \(\s*\n\s*select 1 from mychef_inbox\.decision_records d\s*\n\s*where d\.workspace_id = c\.workspace_id and d\.conversation_id = c\.id\s*\n\s*\)/,
  );
});

test("getConversation decides on the turn and still exposes the previous decision", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(store, /decided: decisionState === "decided"/);
  assert.match(store, /previousDecision: latestDecision/);
  // The old form — any decision ever — must be gone.
  assert.doesNotMatch(store, /decided: Boolean\(decisions\[0\]\)/);
});

test("a conversation id is no longer cast to a uuid on the desk", () => {
  const desk = read("src/app/[workspace]/inbox/desk.tsx");
  assert.match(desk, /async function getSelectedDecision\(id: string\)/);
  assert.match(desk, /if \(DECISION_ID\.test\(id\)\) return getRecordedDecision\(id\)/);
  assert.match(desk, /getLatestDecisionForConversation\(id\)/);
  assert.doesNotMatch(desk, /getRecordedDecision\(selectedId\)/);
});
