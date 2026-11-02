/**
 * B3: a verdict is irreversible, so it must name the object it is about.
 *
 * Two halves:
 *   1. the pure helpers the desk renders and the store compares — same functions both sides;
 *   2. the real `reviewConversation`, with the pool replaced at the module boundary, proving that a
 *      missing or wrong name writes nothing and a correct one writes exactly one decision.
 *
 * No database, no network: nothing here can write to Neon.
 */

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMATION_REFUSAL,
  confirmationMatches,
  confirmationPrompt,
  decisionTarget,
} from "@/lib/decision-confirmation";

type Row = Record<string, unknown>;

const state = { log: [] as { sql: string; params: unknown[] }[] };

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function respond(sql: string, params: unknown[] = []): { rows: Row[] } {
  const s = norm(sql);
  state.log.push({ sql: s, params });
  if (s.startsWith("select c.id, c.contact_id")) {
    return {
      rows: [
        {
          id: "A4FNMhVs3tJmKKRTDi0j",
          contact_id: "contact-1",
          contact_name: "  Maya   Chen ",
          facts: {},
          project_id: "mychef",
          status: "needs_reply",
          channel: "email",
          last_message_at: new Date("2026-11-01T09:00:00.000Z"),
        },
      ],
    };
  }
  if (s.startsWith("select id, direction, body, created_at")) {
    return { rows: [{ id: "msg-1", direction: "inbound", body: "hello", created_at: new Date() }] };
  }
  if (s.startsWith("select id::text as id, body, model")) {
    return {
      rows: [
        {
          id: "draft-1",
          body: "Draft body.",
          model: "local",
          created_at: new Date(),
          source_ids: null,
          prompt_version: null,
        },
      ],
    };
  }
  if (s.startsWith("select id::text as id from mychef_inbox.decision_records")) {
    return { rows: [] };
  }
  if (s.startsWith("insert into mychef_inbox.feedback")) {
    return { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
  }
  if (s.startsWith("insert into mychef_inbox.decision_records")) {
    return { rows: [{ id: "33333333-3333-4333-8333-333333333333" }] };
  }
  return { rows: [] };
}

function fakeClient() {
  return {
    query: async (sql: string, params: unknown[] = []) => respond(sql, params),
    release: () => {
      state.log.push({ sql: "release", params: [] });
    },
  };
}

mock.module("@/db/client", {
  namedExports: {
    appPool: {
      query: async (sql: string, params: unknown[] = []) => respond(sql, params),
      connect: async () => fakeClient(),
    },
    keyPool: { query: async () => ({ rows: [] }) },
    appDb: {},
    keyDb: {},
  },
});

type Store = {
  reviewConversation: (
    conversationId: string,
    authorId: string,
    input: {
      humanDecision: "accepted" | "edited" | "rejected" | "escalated";
      reasonCode: string;
      rationale: string;
      whyNot: string;
      finalText: string;
      confirmName?: string;
    },
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
};
let store: Store;

before(async () => {
  store = (await import("@/data/mychef-store")) as unknown as Store;
});

beforeEach(() => {
  state.log = [];
});

const review = (confirmName?: string) =>
  store.reviewConversation("A4FNMhVs3tJmKKRTDi0j", "operator@mychef.id", {
    humanDecision: "accepted",
    reasonCode: "good_as_drafted",
    rationale: "Correct.",
    whyNot: "",
    finalText: "Draft body.",
    confirmName,
  });

const writes = () => state.log.filter((entry) => entry.sql.startsWith("insert into")).length;

// ------------------------------------------------------------------ the helpers

test("the target is the contact name, tidied", () => {
  assert.equal(
    decisionTarget({ contactName: "  Maya   Chen ", conversationId: "A4FNMhVs3tJmKKRTDi0j" }),
    "Maya Chen",
  );
});

test("an unnamed contact gets a stable handle instead of an empty prompt", () => {
  const target = decisionTarget({ contactName: null, conversationId: "A4FNMhVs3tJmKKRTDi0j" });
  assert.equal(target, "unnamed contact RTDi0j");
  assert.equal(decisionTarget({ contactName: "  ", conversationId: "abc123" }), "unnamed contact abc123");
});

test("the confirmation ignores case and spacing, and never accepts an empty answer", () => {
  const target = "Maya Chen";
  assert.equal(confirmationMatches("Maya Chen", target), true);
  assert.equal(confirmationMatches("  maya   chen ", target), true);
  assert.equal(confirmationMatches("MAYA CHEN", target), true);
  assert.equal(confirmationMatches("Maya", target), false);
  assert.equal(confirmationMatches("Maya Chen ", "Maya Chen"), true);
  assert.equal(confirmationMatches("", target), false);
  assert.equal(confirmationMatches("   ", target), false);
  assert.equal(confirmationMatches(null, target), false);
  assert.equal(confirmationMatches(undefined, target), false);
});

test("the prompt and the refusal name the object and promise nothing was recorded", () => {
  assert.match(confirmationPrompt("Maya Chen"), /Maya Chen/);
  assert.match(confirmationPrompt("Maya Chen"), /cannot be undone/);
  assert.match(CONFIRMATION_REFUSAL, /[Nn]ame the person/);
  assert.match(CONFIRMATION_REFUSAL, /[Nn]othing was recorded/);
});

// ------------------------------------------------------------------ the store

test("a verdict with no name is refused before anything is written", async () => {
  const result = await review(undefined);
  assert.equal(result.ok, false);
  assert.equal(result.error, CONFIRMATION_REFUSAL);
  assert.equal(writes(), 0, "no feedback, decision or audit row");
  assert.equal(state.log.filter((entry) => entry.sql === "begin").length, 0);
});

test("a verdict naming someone else is refused, and nothing is written", async () => {
  const result = await review("Someone Else");
  assert.equal(result.ok, false);
  assert.equal(result.error, CONFIRMATION_REFUSAL);
  assert.equal(writes(), 0);
});

test("a verdict naming the person is recorded once", async () => {
  const result = await review("maya chen");
  assert.equal(result.ok, true, result.error);
  assert.equal(
    state.log.filter((entry) => entry.sql.startsWith("insert into mychef_inbox.decision_records")).length,
    1,
  );
  assert.equal(
    state.log.filter((entry) => entry.sql.startsWith("insert into mychef_inbox.feedback")).length,
    1,
  );
});

test("every write still binds the workspace first", async () => {
  await review("Maya Chen");
  for (const write of state.log.filter((entry) => entry.sql.startsWith("insert into"))) {
    assert.equal(write.params[0], "mychef", write.sql.slice(0, 60));
  }
});
