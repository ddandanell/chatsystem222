/**
 * CS-021: one registry for reason codes.
 *
 * Before this, three files carried three hard-coded lists. The desk could show a code (too_long,
 * wrong_price, invented_detail, ignored_question, wrong_recommendation, multiple_asks, no_next_step,
 * off_brand, repeats_guest) that produced no statement, no group and no queue, so the correction was
 * stored in the ledger and counted nowhere. These tests fail when a code is added without a route.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QUEUE_TYPES,
  groupForReason,
  isKnowledgeGapReason,
  isLearnableReason,
  queueTypeForReason,
  statementForReason,
} from "@/lib/learning-queue";
import { REASON_CODES, REASON_SPECS, isReasonCode, reasonLabel, reasonSpec } from "@/lib/reason-codes";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const NINE = [
  "too_long",
  "wrong_price",
  "invented_detail",
  "ignored_question",
  "wrong_recommendation",
  "multiple_asks",
  "no_next_step",
  "off_brand",
  "repeats_guest",
];

test("every code in the picker resolves to a registered spec", () => {
  for (const item of REASON_CODES) {
    const spec = reasonSpec(item.code);
    assert.ok(spec, `${item.code} is in the picker with no registry row`);
    assert.equal(spec.code, item.code);
    assert.equal(spec.label, item.label, `${item.code} label drifted between picker and registry`);
  }
});

test("no code resolves to a silent default any more", () => {
  for (const spec of REASON_SPECS) {
    assert.ok(spec.statement.trim().length > 20, `${spec.code} has no actionable statement`);
    assert.ok(QUEUE_TYPES.includes(spec.queue), `${spec.code} has an unknown queue ${spec.queue}`);
    assert.ok(
      ["knowledge_gap", "procedure_gap", "escalation", "retrieval"].includes(spec.group),
      `${spec.code} has an unknown learning group ${spec.group}`,
    );
    assert.equal(queueTypeForReason(spec.code), spec.queue);
    assert.equal(groupForReason(spec.code), spec.group);
    assert.equal(isLearnableReason(spec.code), spec.learnable);
  }
});

test("the nine feedback codes the desk collects are registered end to end", () => {
  for (const code of NINE) {
    assert.ok(isReasonCode(code), `${code} is not a reason code`);
    assert.notEqual(reasonLabel(code), code, `${code} has no human label`);
    const statement = statementForReason(code, 3);
    assert.ok(statement, `${code} produces no learning statement`);
    assert.equal(statement.key, code);
    assert.ok(statement.statement.includes(code), `${code} statement does not name its code`);
    assert.ok(statement.statement.includes("3 times"), `${code} statement lost the evidence count`);
  }
});

test("the original mapping did not move", () => {
  const original: [string, string][] = [
    ["wrong_policy", "Missing Knowledge"],
    ["missing_knowledge", "Missing Knowledge"],
    ["too_formal", "Tone"],
    ["too_casual", "Tone"],
    ["wrong_fact", "Outdated"],
    ["irrelevant_source", "Outdated"],
    ["missed_upsell", "Suggested"],
    ["should_have_asked", "Suggested"],
    ["customer_angry", "Suggested"],
    ["needs_human", "Suggested"],
  ];
  for (const [code, queue] of original) {
    assert.equal(queueTypeForReason(code), queue, `${code} moved queue`);
  }
  assert.equal(isKnowledgeGapReason("wrong_policy"), true);
  assert.equal(isKnowledgeGapReason("too_long"), false);
  assert.equal(isKnowledgeGapReason("invented_detail"), true);
});

test("good as drafted is a good outcome, not a correction", () => {
  assert.equal(statementForReason("good_as_drafted", 9), null);
  assert.equal(isLearnableReason("good_as_drafted"), false);
  assert.equal(queueTypeForReason("good_as_drafted"), "Suggested");
});

test("an unregistered code cannot invent a statement", () => {
  assert.equal(statementForReason("made_up_code", 1), null);
  assert.equal(isReasonCode("made_up_code"), false);
  assert.equal(reasonSpec("made_up_code"), null);
});

test("a price correction routes to a knowledge group, a length correction to procedure", () => {
  assert.equal(groupForReason("wrong_price"), "knowledge_gap");
  assert.equal(queueTypeForReason("wrong_price"), "Outdated");
  assert.equal(groupForReason("invented_detail"), "knowledge_gap");
  assert.equal(queueTypeForReason("invented_detail"), "Missing Knowledge");
  assert.equal(groupForReason("too_long"), "procedure_gap");
  assert.equal(queueTypeForReason("off_brand"), "Tone");
});

test("the store and the loop read the registry instead of their own lists", () => {
  const store = read("src/data/mychef-store.ts");
  const loop = read("src/lib/learning-loop.ts");
  assert.match(store, /statementForReason\(/);
  assert.doesNotMatch(store, /\["wrong_policy", "wrong_fact", "missing_knowledge"\]\.includes\(reason\)/);
  assert.match(loop, /reasonSpec\(reason\)/);
  assert.doesNotMatch(loop, /const KNOWLEDGE = new Set/);
  assert.doesNotMatch(loop, /const PROCEDURE = new Set/);
});
