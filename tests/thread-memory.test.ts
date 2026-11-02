/**
 * MC-168/169/170 — the standing suggestion, grounded on the whole thread, and unable to repeat it.
 *
 * David's words, 2026-11-01 18:41 +08: "every time I go into a client, the AI suggestion should
 * already be generated and standing there"; it must know the conversation "start to end"; it must be
 * "extremely professional, not repeating".
 *
 * These tests are pure: no database, no network, no provider key. The one behaviour they pin that
 * used to be the opposite is that the local reply now asks for nothing the guest has already given —
 * the seeded thread below is exactly the case that produced the old duplicate question.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AGENT_MESSAGE_LIMIT,
  AGENT_PROMPT_VERSION,
  buildAgentPrompt,
  selectAgentThread,
  type AgentContext,
} from "@/lib/agent-context";
import {
  composeLocalReply,
  draftAgeLabel,
  draftFreshness,
  repeatViolations,
  selectThreadWindow,
  statesPrice,
  threadBrief,
  threadReadLabel,
  type ThreadMessage,
} from "@/lib/thread-memory";
import { localAgentReply, runConversationAgent } from "@/lib/conversation-agent";
import { MYCHEF_RETRIEVAL_SCOPE, rankKnowledgeRows, type KnowledgeCandidate } from "@/lib/retrieval-policy";

const ROOT = process.cwd();

const at = (minutes: number): string => new Date(Date.UTC(2026, 10, 1, 2, minutes, 0)).toISOString();

/**
 * The seeded thread from the ticket: the guest gives the date and the party size in the first
 * message, myCHEF answers, and the guest comes back with a question. The old draft read only the
 * last inbound message and asked for both details again.
 */
const SEEDED: ThreadMessage[] = [
  {
    id: "m1",
    direction: "inbound",
    body: "Hi, we are 8 guests on 20 November in Villa Bidadari. Can you cook for us?",
    created_at: at(0),
  },
  {
    id: "m2",
    direction: "outbound",
    body: "Thank you for reaching out. Could you confirm the start time and any dietary requirements?",
    created_at: at(5),
  },
  {
    id: "m3",
    direction: "inbound",
    body: "Dinner at 7pm works. Two of us are vegetarian. What would the menu look like?",
    created_at: at(12),
  },
];

/* --------------------------------------------------------------- 169: the whole thread */

test("the thread window keeps the first message, so a long conversation is still read start to end", () => {
  const many: ThreadMessage[] = Array.from({ length: 30 }, (_, index) => ({
    id: `m${index}`,
    direction: "inbound",
    body: `message ${index}`,
    created_at: at(index),
  }));
  const window = selectThreadWindow(many, AGENT_MESSAGE_LIMIT);
  assert.equal(window.length, AGENT_MESSAGE_LIMIT);
  assert.equal(window[0]?.id, "m0", "the opening message must survive the window");
  assert.equal(window[1]?.id, "m11");
  assert.equal(window[window.length - 1]?.id, "m29");
  // The old window was slice(-20): it opened at m10 and forgot how the conversation started.
  assert.equal(many.slice(-AGENT_MESSAGE_LIMIT)[0]?.id, "m10");
});

test("the brief reports how many messages it read, and what the guest already settled", () => {
  const brief = threadBrief(SEEDED);
  assert.equal(brief.messagesRead, 3);
  assert.equal(brief.inbound, 2);
  assert.equal(brief.outbound, 1);
  assert.equal(brief.facts.date.known, true);
  assert.equal(brief.facts.guests.known, true);
  assert.equal(brief.facts.location.known, true);
  assert.equal(brief.facts.time.known, true);
  assert.equal(brief.facts.dietary.known, true);
  assert.deepEqual(brief.askedIds, []);
  assert.equal(brief.hasOutbound, true);
});

test("a guest fact counts only when the guest stated it, never when myCHEF proposed it", () => {
  const brief = threadBrief([
    { direction: "inbound", body: "Can you cook for us?", created_at: at(0) },
    { direction: "outbound", body: "We can do 20 November for 8 guests.", created_at: at(2) },
  ]);
  assert.equal(brief.facts.date.known, false);
  assert.equal(brief.facts.guests.known, false);
});

/* --------------------------------------------------------------- 170: no repetition */

test("the three ways a reply repeats a thread are each named", () => {
  const reintroduced = repeatViolations(
    "Hi again, dinner at 7pm is confirmed and two vegetarian mains are ready.",
    SEEDED,
  );
  assert.deepEqual(reintroduced.map((violation) => violation.code), ["reintroduction"]);

  const repeated = repeatViolations(
    "Two of us are vegetarian is fine. Could you confirm the start time and any dietary requirements?",
    SEEDED,
  );
  assert.ok(repeated.some((violation) => violation.code === "repeated_reply"));

  const reasked = repeatViolations("Happy to help. What date did you have in mind?", SEEDED);
  assert.deepEqual(reasked.map((violation) => violation.code), ["reasked_question"]);
  assert.match(reasked[0]?.detail ?? "", /already gave the date/);
});

test("a genuinely new reply trips none of the three, so the gate is not just refusing everything", () => {
  const fresh =
    "The menu for seven o'clock is four courses with a vegetarian main. I will send the dishes once the kitchen confirms them.";
  assert.deepEqual(repeatViolations(fresh, SEEDED), []);
});

test("the local reply asks for nothing the seeded thread already answered", () => {
  const reply = localAgentReply([], "What would the menu look like?", SEEDED);
  const questions = reply.text.split(/(?<=[.?])\s+/).filter((sentence) => sentence.endsWith("?"));
  for (const question of questions) {
    assert.doesNotMatch(
      question,
      /date|day|guests|people|villa|area|time|dietary/i,
      `this question re-asks something the guest already gave: ${question}`,
    );
  }
  assert.equal(reply.asked.length, 0);
  // The state of the thread is still named, so the operator can see it was read.
  assert.match(reply.text, /I have the date, the number of guests and the villa or area from your messages\./);
  // And the old behaviour is reproduced here, so the regression is unambiguous.
  const oldStyle = "Could you confirm the date you have in mind and the number of guests?";
  assert.ok(repeatViolations(oldStyle, SEEDED).some((v) => v.code === "reasked_question"));
});

test("with no approved knowledge the reply says it cannot confirm a price, and states none", () => {
  const reply = localAgentReply([], "What would the menu look like?", SEEDED);
  assert.match(reply.text, /cannot confirm a price/i);
  assert.equal(statesPrice(reply.text), false);
  assert.doesNotMatch(reply.text, /\d[\d.,]*\s*(idr|rp|usd|per guest)/i);
});

test("a thread myCHEF has already answered is not greeted again", () => {
  const reply = localAgentReply([], "What would the menu look like?", SEEDED);
  assert.doesNotMatch(reply.text, /^(hi|hello|hey|thank you|thanks)/i);

  const first = localAgentReply([], "Hi, we are 8 guests on 20 November.", [SEEDED[0]!]);
  assert.match(first.text, /^Thank you for reaching out\./);
});

test("with an approved source the reply quotes it instead of saying it cannot price", () => {
  const rows: KnowledgeCandidate[] = [
    {
      id: "k1",
      title: "03-PRICING_RULES.md",
      content:
        "Private chef dinner starts at IDR 850,000 per guest with a minimum of six guests. Travel outside the villa area is quoted separately.",
      status: "approved",
      source: "import",
      project_id: "mychef",
      workspace_id: "mychef",
    },
  ];
  const ranked = rankKnowledgeRows(rows, "menu");
  const reply = localAgentReply(
    ranked.eligible.map((item) => ({
      id: item.doc.id,
      title: item.doc.title,
      kind: item.kind,
      excerpt: item.doc.content,
    })),
    "What would the menu look like?",
    SEEDED,
  );
  assert.match(reply.text, /IDR 850,000/);
  assert.doesNotMatch(reply.text, /cannot confirm a price/i);
  assert.doesNotMatch(reply.text, /what date|how many guests/i);
});

test("the composer never re-introduces, re-asks or repeats on any of its own output", () => {
  const reply = composeLocalReply([], SEEDED);
  assert.deepEqual(repeatViolations(reply.text, SEEDED), []);
});

/* --------------------------------------------------------------- 170: the provider guard */

const KEY = { secret: "sk-test-not-a-real-key", baseUrl: null };

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    workspaceId: "mychef",
    projectId: "mychef",
    conversationId: "conv-1",
    contactName: "Ada Lovelace",
    channel: "email",
    status: "open",
    tags: ["booking"],
    contactFacts: {},
    messages: SEEDED.map((message) => ({
      id: message.id ?? "m",
      direction: message.direction,
      body: message.body,
      created_at: message.created_at ?? at(0),
      conversation_id: "conv-1",
    })),
    ranked: [],
    ...overrides,
  };
}

function okFetch(reply: Record<string, unknown>) {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reply) } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
}

test("a provider answer that re-asks an answered question is refused, and the reason is named", async () => {
  const draft = await runConversationAgent(context(), {
    orgId: "mychef",
    resolve: async () => KEY,
    fetchImpl: okFetch({
      reply: "Happy to help. What date did you have in mind, and how many guests will join?",
      why: "x",
      why_not: "y",
      escalate: false,
    }),
    order: ["deepseek"],
  });
  assert.equal(draft.fellBack, true);
  assert.equal(draft.provider, "local");
  assert.match(draft.notice ?? "", /desk guard refused it/);
  assert.match(draft.notice ?? "", /reasked_question/);
  assert.doesNotMatch(draft.draftText, /what date/i);
});

test("a provider answer that puts a price on screen with no approved source is refused", async () => {
  const draft = await runConversationAgent(context(), {
    orgId: "mychef",
    resolve: async () => KEY,
    fetchImpl: okFetch({
      reply: "Dinner is IDR 850,000 per guest, and we can do seven o'clock.",
      why: "x",
      why_not: "y",
      escalate: false,
    }),
    order: ["deepseek"],
  });
  assert.equal(draft.fellBack, true);
  assert.match(draft.notice ?? "", /unbacked_price/);
  assert.equal(statesPrice(draft.draftText), false);
  assert.match(draft.draftText, /cannot confirm a price/i);
});

test("a clean provider answer still becomes the draft, so the guard refuses rather than replaces", async () => {
  const rows: KnowledgeCandidate[] = [
    {
      id: "k1",
      title: "03-PRICING_RULES.md",
      content:
        "Private chef dinner starts at IDR 850,000 per guest with a minimum of six guests. Travel outside the villa area is quoted separately.",
      status: "approved",
      source: "import",
      project_id: "mychef",
      workspace_id: "mychef",
    },
  ];
  const draft = await runConversationAgent(context({ ranked: rankKnowledgeRows(rows, "menu").eligible }), {
    orgId: "mychef",
    resolve: async () => KEY,
    fetchImpl: okFetch({
      reply:
        "Seven o'clock works. The vegetarian main is a smoked pumpkin and cashew curry, and the rest of the menu follows the market that morning.",
      why: "Quoted the approved pricing rule.",
      why_not: "No final price before the kitchen confirms the market.",
      escalate: false,
    }),
    order: ["deepseek"],
  });
  assert.equal(draft.fellBack, false);
  assert.equal(draft.provider, "deepseek");
  assert.equal(draft.thread.messagesRead, 3);
  assert.equal(draft.thread.outbound, 1);
});

test("the prompt carries the whole thread, what is already answered, and the no-repeat rules", () => {
  const { system, user } = buildAgentPrompt(context());
  assert.equal(AGENT_PROMPT_VERSION, "conversation-agent-v2");
  assert.match(system, /Never repeat a sentence from an earlier myCHEF message/);
  assert.match(system, /Never ask for anything the thread already answers/);
  assert.match(system, /cannot confirm a price yet/);
  assert.match(user, /THREAD \(this conversation only, 3 messages, oldest first\)/);
  assert.match(user, /ALREADY ANSWERED IN THIS THREAD/);
  assert.match(user, /number of guests: 8 guests/);
  assert.match(user, /do not greet or thank the guest again/);
  assert.match(user, /<message from="guest"[^>]*>\nHi, we are 8 guests/);
});

test("the prompt names the project scope it may quote from", () => {
  assert.equal(MYCHEF_RETRIEVAL_SCOPE.projectId, "mychef");
  assert.deepEqual(
    selectAgentThread(context()).map((message) => message.id),
    ["m1", "m2", "m3"],
  );
});

/* --------------------------------------------------------------- 168: the standing draft */

test("freshness: no draft, a stale draft, a draft missing its why, and a current draft", () => {
  const messages: ThreadMessage[] = [
    { direction: "inbound", body: "first", created_at: at(0) },
    { direction: "inbound", body: "second", created_at: at(30) },
  ];
  assert.deepEqual(draftFreshness(messages, null, at(31)), { needsDraft: true, reason: "none" });
  assert.equal(
    draftFreshness(messages, { body: "d", created_at: at(10), why: "w" }, at(31)).reason,
    "stale_turn",
  );
  assert.equal(
    draftFreshness(messages, { body: "d", created_at: at(40), confidence: null }, at(41)).reason,
    "stale_meta",
  );
  assert.deepEqual(
    draftFreshness(messages, { body: "d", created_at: at(40), why: "w" }, at(41)),
    { needsDraft: false, reason: "fresh" },
  );
});

test("the age of the suggestion reads as a person would say it", () => {
  const now = at(60);
  assert.equal(draftAgeLabel(at(60), now), "suggested just now");
  assert.equal(draftAgeLabel(at(57), now), "suggested 3 min ago");
  assert.equal(draftAgeLabel(at(60 - 125), now), "suggested 2 h ago");
  assert.equal(draftAgeLabel(at(60 - 60 * 40), now), "suggested yesterday");
  assert.equal(draftAgeLabel(null, now), null);
  assert.equal(draftAgeLabel("not a date", now), null);
});

test("the coverage label says how much of a long thread was read, without rounding it up", () => {
  assert.equal(threadReadLabel({ messagesRead: 14 }), "read 14 messages");
  assert.equal(threadReadLabel({ messagesRead: 1 }), "read 1 message");
  assert.equal(
    threadReadLabel({ messagesRead: 50, messagesTotal: 1514 }),
    "read 50 of 1514 messages",
  );
  assert.equal(threadReadLabel(null), null);
  assert.equal(threadReadLabel({ messagesRead: 0 }), null);
});

test("the desk renders the stored draft and refreshes behind it, instead of generating in the render path", () => {
  const desk = readFileSync(`${ROOT}/src/app/[workspace]/inbox/desk.tsx`, "utf8");
  assert.doesNotMatch(
    desk,
    /await ensureDraftForConversation\(/,
    "MC-168: opening a conversation must not wait on a generator",
  );
  assert.match(desk, /draftFreshness\(/);
  assert.match(desk, /draftAgeLabel\(/);

  const review = readFileSync(`${ROOT}/src/components/inbox/desk-review.tsx`, "utf8");
  assert.match(review, /ensureDraftAction\(/, "the refresh happens behind the page");
  assert.match(review, /threadReadLabel\(conversation\.draft\.thread\)/);
  assert.match(review, /\{draftAge\}/);
});
