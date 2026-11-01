/**
 * CS-020 renegotiate, CS-022 rejected drafts learn.
 *
 * CS-020: regenerate() called the drafter with no payload, so the operator's written correction never
 * reached the provider and nothing learned. The correction now travels as the instruction, is stored
 * in the draft provenance, and becomes a pending situational case.
 *
 * CS-022: a rejected draft created no case because the guard read `remember && edited`. A rejection
 * with a written reason now queues a case too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProposalContent, parseProposalMeta } from "@/lib/learning-queue";
import { renegotiateDraft } from "@/data/mychef-store";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("a blank correction is refused before anything is written or called", async () => {
  for (const correction of ["", "   ", "\n\t "]) {
    const result = await renegotiateDraft("conv-anything", "qa@mychef.id", correction);
    assert.equal(result.ok, false);
    assert.match(result.error, /Write what should change/);
  }
});

test("the correction is the snippet the learning queue reads back", () => {
  const correction = "Too long, and it quoted a rate we have not confirmed.";
  const content = buildProposalContent({
    evidence: 1,
    group: "procedure_gap",
    reason: "renegotiate",
    queueType: "Suggested",
    snippet: correction,
    diffs: [{ decisionId: "conv-anna", ai: "Dinner is IDR 850,000 per guest.", human: "", why: correction }],
  });
  const meta = parseProposalMeta(content);
  assert.equal(meta.snippet, correction);
  assert.equal(meta.reason, "renegotiate");
  assert.equal(meta.queueType, "Suggested");
  assert.equal(meta.group, "procedure_gap");
  assert.equal(meta.diffs[0]?.decisionId, "conv-anna");
  assert.equal(meta.diffs[0]?.why, correction);
});

test("the desk's renegotiate carries the text into the action instead of re-rolling blindly", () => {
  const desk = read("src/components/inbox/desk-review.tsx");
  assert.match(desk, /renegotiateAction\(conversation\.id, text\)/);
  assert.match(desk, /setCorrectionNotice\("Write what should change before renegotiating\."\)/);
  assert.doesNotMatch(desk, /onClick=\{regenerate\}[\s\S]{0,80}Regenerate/);
  const action = read("src/app/[workspace]/inbox/mychef-actions.ts");
  assert.match(action, /renegotiateDraft\(\s*conversationId,/);
});

test("the store passes the correction as the agent instruction and keeps the case pending", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(store, /agentDraftForConversation\(conversationId, authorId, text\)/);
  assert.match(store, /`correction:\$\{conversationId\}`/);
  assert.match(store, /'situational', 1, \$5, 'general'/);
  assert.match(store, /'renegotiate'/);
  assert.doesNotMatch(store, /set status = 'approved'[\s\S]{0,120}correction/);
});

test("a rejection with a written reason now creates a learning case", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(store, /input\.humanDecision === "edited" \|\| input\.humanDecision === "rejected"/);
  assert.match(store, /const decisionSignal = input\.rationale\.trim\(\) \|\| input\.whyNot\.trim\(\)/);
  assert.match(store, /decisionSignal &&/);
  assert.match(store, /## Rejected as drafted/);
  // An edit still needs changed text; a rejection does not have a replacement to compare.
  assert.match(store, /input\.humanDecision === "rejected" \|\| finalText\.trim\(\) !== conversation\.draft\.body\.trim\(\)/);
});

test("a pending situational case can be approved, not only retired", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(
    store,
    /set status = 'approved', updated_at = now\(\), version = version \+ 1\s+where workspace_id = \$1 and id = \$2\s+and source in \('ledger-rule', 'learning-pass', 'situational'\) and status = 'pending'/,
  );
});
