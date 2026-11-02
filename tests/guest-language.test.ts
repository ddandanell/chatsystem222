/**
 * Phase 2 language: Indonesian is named, the reply stays in that language,
 * and the reviewer is not shown a made-up English translation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAgentPrompt } from "@/lib/agent-context";
import {
  detectGuestLanguage,
  replyLanguageLine,
  reviewerLanguageLine,
} from "@/lib/guest-language";

const ROOT = process.cwd();

function context(body: string) {
  return {
    workspaceId: "mychef",
    projectId: "mychef",
    conversationId: "conv-1",
    contactName: "Ada",
    channel: "whatsapp",
    status: "open",
    tags: [],
    contactFacts: {},
    messages: [
      {
        id: "m1",
        direction: "inbound",
        body,
        created_at: "2026-11-01T02:00:00Z",
        conversation_id: "conv-1",
      },
    ],
    ranked: [],
  };
}

test("an Indonesian guest message is named Indonesian", () => {
  const language = detectGuestLanguage(
    "Saya mau pesan makan malam untuk 8 orang besok. Apakah bisa?",
  );
  assert.equal(language.code, "id");
  assert.match(reviewerLanguageLine(language) ?? "", /Indonesian/);
  assert.match(replyLanguageLine(language), /Write the reply in Indonesian/);
  assert.match(replyLanguageLine(language), /why and why_not in English/);
});

test("an English guest message stays quiet on the desk", () => {
  const language = detectGuestLanguage("Could you hold dinner for 8 on Friday, please?");
  assert.equal(language.code, "en");
  assert.equal(reviewerLanguageLine(language), null);
  assert.match(replyLanguageLine(language), /Write the reply in English/);
});

test("the drafter is told the guest language, and nothing is sent", () => {
  const indonesian = buildAgentPrompt(
    context("Saya mau pesan makan malam untuk 8 orang besok."),
  );
  assert.match(indonesian.user, /Write the reply in Indonesian/);
  assert.match(indonesian.system, /never send anything/i);
  const english = buildAgentPrompt(context("Could you hold dinner for 8 on Friday, please?"));
  assert.match(english.user, /Write the reply in English/);
  assert.doesNotMatch(english.user, /Write the reply in Indonesian/);
});

test("the desk shows the language line and does not invent an English translation", () => {
  const source = readFileSync(join(ROOT, "src/lib/guest-language.ts"), "utf8");
  const desk = readFileSync(join(ROOT, "src/components/inbox/desk-review.tsx"), "utf8");
  assert.match(source, /Do not invent an English translation/);
  assert.match(desk, /data-slot="guest-language"/);
  assert.doesNotMatch(desk, /Translated:/);
});
