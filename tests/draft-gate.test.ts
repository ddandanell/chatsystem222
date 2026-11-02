/**
 * CS-018: the G0 draft gate.
 *
 * The production case this was written against: a draft scoring 3 of 5 on the C/S/T/R/N rubric was
 * approved as drafted 12.19 s after it appeared, with no score, no gate state and no "below bar" on
 * the button. These tests pin the five checks, the fail-closed paths, and the fact that a human can
 * still approve below the bar but only through an explicit confirmation that is recorded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRAFT_GATE_VERSION, gateAuditAction, gateDraft } from "@/lib/draft-gate";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const THREAD = [
  { direction: "inbound", body: "Hi, we are 8 guests at Villa Bidadari on 20 November. Can you do dinner?" },
  { direction: "outbound", body: "Thank you for the details. I can hold dinner for 8 on 20 November." },
  { direction: "inbound", body: "Great. What time should we sit down, and is the price per person?" },
];

const CLEAN =
  "I have the date, the villa and the party size. Dinner can start at 19:00. I cannot confirm a price yet — the figure is checked before anything is booked. Could you confirm any dietary requirements?";

test("a clean reply passes all five checks", () => {
  const gate = gateDraft({ draftText: CLEAN, thread: THREAD, sources: [] });
  assert.equal(gate.state, "pass");
  assert.equal(gate.score, 5);
  assert.equal(gate.max, 5);
  assert.equal(gate.passes, true);
  assert.equal(gate.belowBar, false);
  assert.equal(gate.blockedBy, null);
  assert.equal(gate.summary, "gate 5/5");
  assert.deepEqual(
    gate.checks.map((check) => check.id),
    ["C", "S", "T", "R", "N"],
  );
});

test("the gate is deterministic: the same draft scores the same twice", () => {
  assert.deepEqual(
    gateDraft({ draftText: CLEAN, thread: THREAD, sources: [] }),
    gateDraft({ draftText: CLEAN, thread: THREAD, sources: [] }),
  );
});

test("a price with no approved source is below bar and says so", () => {
  const gate = gateDraft({
    draftText: "Dinner is IDR 850,000 per guest, and we can start at 19:00.",
    thread: THREAD,
    sources: [],
  });
  assert.equal(gate.passes, false);
  assert.equal(gate.blockedBy, "S");
  assert.match(gate.summary, /below bar 4\/5/);
  assert.match(gate.checks.find((check) => check.id === "S")?.why ?? "", /cites no approved source/);
});

test("the same price passes when an approved source is cited", () => {
  const gate = gateDraft({
    draftText: "Dinner is IDR 850,000 per guest, and we can start at 19:00.",
    thread: THREAD,
    sources: [{ id: "03-PRICING_RULES", status: "approved" }],
  });
  assert.equal(gate.checks.find((check) => check.id === "S")?.pass, true);
  assert.equal(gate.score, 5);
});

test("citing a pending or unknown source fails closed", () => {
  for (const status of ["pending", "retired", null, undefined]) {
    const gate = gateDraft({
      draftText: CLEAN,
      thread: THREAD,
      sources: [{ id: "07-03-BUSINESS_RULES_POLICIES", status }],
    });
    const check = gate.checks.find((item) => item.id === "S");
    assert.equal(check?.pass, false, `status ${String(status)} must not pass`);
    assert.equal(gate.passes, false);
  }
});

test("shouting, exclamation marks and hype fail the tone check", () => {
  for (const text of [
    "Dinner is CONFIRMED for 20 November.",
    "Wonderful! Dinner is confirmed for 20 November.",
    "This is the best in Bali and we guarantee it.",
  ]) {
    const gate = gateDraft({ draftText: text, thread: THREAD, sources: [] });
    assert.equal(gate.checks.find((check) => check.id === "T")?.pass, false, text);
    assert.equal(gate.passes, false);
  }
});

test("a duplicated sentence and a repeated guest sentence both fail the repeats check", () => {
  const duplicated = gateDraft({
    draftText: "Dinner is held for eight guests at 19:00. Dinner is held for eight guests at 19:00.",
    thread: THREAD,
    sources: [],
  });
  assert.equal(duplicated.checks.find((check) => check.id === "R")?.pass, false);

  const echoed = gateDraft({
    draftText: "Hi, we are 8 guests at Villa Bidadari on 20 November. I have that confirmed.",
    thread: THREAD,
    sources: [],
  });
  const repeat = echoed.checks.find((check) => check.id === "R");
  assert.equal(repeat?.pass, false);
  assert.match(repeat?.why ?? "", /repeats the guest/);
});

test("two questions fail the next-step check, one question passes", () => {
  const two = gateDraft({
    draftText: "I can hold dinner. What time would you like? Does anyone have allergies?",
    thread: THREAD,
    sources: [],
  });
  assert.equal(two.checks.find((check) => check.id === "N")?.pass, false);
  assert.match(two.summary, /below bar/);

  const one = gateDraft({
    draftText: "I can hold dinner for eight at 19:00. Does anyone have allergies?",
    thread: THREAD,
    sources: [],
  });
  assert.equal(one.checks.find((check) => check.id === "N")?.pass, true);
});

test("a placeholder or an unfinished sentence is not a reply", () => {
  for (const text of ["TODO: write the reply.", "See [date] for details.", "I can hold dinner for eight at"]) {
    const gate = gateDraft({ draftText: text, thread: THREAD, sources: [] });
    assert.equal(gate.checks.find((check) => check.id === "C")?.pass, false, text);
  }
});

test("no draft is below bar, not unchecked", () => {
  for (const draftText of ["", "   ", null, undefined]) {
    const gate = gateDraft({ draftText, thread: THREAD, sources: [] });
    assert.equal(gate.state, "no-draft");
    assert.equal(gate.score, 0);
    assert.equal(gate.belowBar, true);
    assert.equal(gate.passes, false);
    assert.equal(gate.summary, "no draft to check");
  }
});

test("a check that throws is an error, and an error is below bar", () => {
  const gate = gateDraft({
    draftText: "Dinner is held for eight.",
    thread: [{ direction: "inbound", body: undefined as unknown as string }],
    sources: [],
  });
  assert.equal(gate.state, "error");
  assert.equal(gate.belowBar, true);
  assert.equal(gate.passes, false);
});

test("the audit action names the score and every failed check", () => {
  const gate = gateDraft({
    draftText: "Dinner is IDR 850,000 per guest! What time would you like?",
    thread: THREAD,
    sources: [],
  });
  assert.equal(gate.belowBar, true);
  assert.equal(gateAuditAction(gate), `draft-gate:below-bar:${gate.score}/5:ST`);
});

test("the gate version is pinned so a stored decision can be read later", () => {
  assert.equal(DRAFT_GATE_VERSION, "g0");
  assert.equal(gateDraft({ draftText: CLEAN, thread: THREAD, sources: [] }).version, "g0");
});

test("the server refuses a below-bar approval without the explicit acknowledgement", () => {
  const store = read("src/data/mychef-store.ts");
  assert.match(store, /gateDraft\(\{/);
  assert.match(store, /gate\.belowBar && input\.humanDecision !== "escalated" && !input\.gateAck/);
  assert.match(store, /gateAuditAction\(gate\)/);
  const action = read("src/app/[workspace]/inbox/mychef-actions.ts");
  assert.match(action, /formData\.get\("gate_ack"\) === "below-bar"/);
  assert.match(action, /gateAck,/);
});

test("the desk shows the gate state on the button and asks before recording below bar", () => {
  const desk = read("src/components/inbox/desk-review.tsx");
  assert.match(desk, /gateDraft\(\{/);
  assert.match(desk, /data-slot="draft-gate"/);
  assert.match(desk, /data-slot="approve"/);
  assert.match(desk, /below bar/);
  assert.match(desk, /if \(decision !== "escalated" && gate\.belowBar && !gateConfirm\)/);
  assert.match(desk, /form\.set\("gate_ack", "below-bar"\)/);
  assert.match(desk, /Approve anyway · below bar/);
});
