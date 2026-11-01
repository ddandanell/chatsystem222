/**
 * CS-001 (P0), behavioural half: a later guest message supersedes the decision instead of being
 * permanently refused, and the review is serialised against the inbound webhook.
 *
 * These call the real `reviewConversation` from the store. The pool is replaced at the module
 * boundary (`@/db/client`), so:
 *   - the SQL the function really issues is recorded, in order,
 *   - a refusal is proven by the statements it did NOT issue (no feedback row, no decision row),
 *   - a competing decision that commits between the pre-read and the lock is simulated, which is
 *     the only way to prove the in-transaction re-check is real rather than decorative.
 *
 * No database, no network: nothing here can write to Neon.
 */

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Row = Record<string, unknown>;

const EARLIER = new Date("2026-11-01T08:00:00.000Z");
const LATER = new Date("2026-11-01T09:00:00.000Z");

type Stmt = { sql: string; params: unknown[] };

const state = {
  /** What the pre-read (`getConversation`) sees. */
  lastInboundAt: null as Date | null,
  lastDecisionAt: null as Date | null,
  /** What the in-transaction re-read sees; `undefined` means "same as the pre-read". */
  lockedInboundAt: undefined as Date | null | undefined,
  lockedDecisionAt: undefined as Date | null | undefined,
  log: [] as Stmt[],
};

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function respond(sql: string, params: unknown[] = []): { rows: Row[] } {
  const s = norm(sql);
  state.log.push({ sql: s, params });
  const verb = s.split(" ")[0]?.toLowerCase() ?? "";

  if (verb === "begin" || verb === "commit" || verb === "rollback" || verb === "select") {
    // handled below by shape
  }

  if (s.startsWith("select c.id, c.contact_id")) {
    return {
      rows: [
        {
          id: "conv-1",
          contact_id: "contact-1",
          contact_name: "Maya",
          facts: {},
          project_id: "mychef",
          status: "needs_reply",
          channel: "email",
          last_message_at: state.lastInboundAt,
          last_inbound_at: state.lastInboundAt,
          last_decision_at: state.lastDecisionAt,
        },
      ],
    };
  }
  if (s.startsWith("select id, direction, body, created_at")) {
    return { rows: [{ id: "msg-1", direction: "inbound", body: "Can we do the 12th?", created_at: state.lastInboundAt }] };
  }
  if (s.startsWith("select id::text as id, body, model")) {
    return {
      rows: [
        {
          id: "draft-1",
          body: "Draft body.",
          model: "local",
          created_at: EARLIER,
          source_ids: null,
          prompt_version: null,
        },
      ],
    };
  }
  if (s.startsWith("select id::text as id, created_at, human_decision, reason_code")) {
    return {
      rows: state.lastDecisionAt
        ? [
            {
              id: "11111111-1111-4111-8111-111111111111",
              created_at: state.lastDecisionAt,
              human_decision: "approved",
              reason_code: "good_as_drafted",
            },
          ]
        : [],
    };
  }
  if (s.includes("for update")) {
    return { rows: [{ id: params[1] }] };
  }
  if (s.startsWith("select (select max(m.created_at)")) {
    const inbound =
      state.lockedInboundAt === undefined ? state.lastInboundAt : state.lockedInboundAt;
    const decision =
      state.lockedDecisionAt === undefined ? state.lastDecisionAt : state.lockedDecisionAt;
    return { rows: [{ last_inbound_at: inbound, last_decision_at: decision }] };
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
      humanDecision: "accepted" | "edited" | "rejected";
      reasonCode: string;
      rationale: string;
      whyNot: string;
      finalText: string;
    },
  ) => Promise<{ ok: boolean; error?: string; id?: string }>;
};
let store: Store;

before(async () => {
  store = (await import("@/data/mychef-store")) as unknown as Store;
});

beforeEach(() => {
  state.log = [];
  state.lastInboundAt = null;
  state.lastDecisionAt = null;
  state.lockedInboundAt = undefined;
  state.lockedDecisionAt = undefined;
});

const review = () =>
  store.reviewConversation("conv-1", "operator@mychef.id", {
    humanDecision: "accepted",
    reasonCode: "good_as_drafted",
    rationale: "Correct.",
    whyNot: "",
    finalText: "Draft body.",
  });

const count = (fragment: string) =>
  state.log.filter((entry) => entry.sql.includes(fragment)).length;

test("a guest follow-up re-opens the thread: the new turn is decided, not refused", async () => {
  // Decision for the 08:00 message, guest wrote again at 09:00 — the shipped code refused this.
  state.lastDecisionAt = EARLIER;
  state.lastInboundAt = LATER;

  const result = await review();

  assert.equal(result.ok, true, result.error);
  assert.equal(count("insert into mychef_inbox.decision_records"), 1);
  assert.equal(count("insert into mychef_inbox.feedback"), 1);
  assert.equal(count("rollback"), 0);
});

test("a decision that still covers the newest message is refused, and nothing is written", async () => {
  state.lastDecisionAt = LATER;
  state.lastInboundAt = EARLIER;

  const result = await review();

  assert.equal(result.ok, false);
  assert.match(String(result.error), /already decided/i);
  assert.equal(count("insert into mychef_inbox.feedback"), 0, "no feedback row on a refusal");
  assert.equal(count("insert into mychef_inbox.decision_records"), 0, "no decision row on a refusal");
  assert.equal(count("begin"), 0, "the refusal happens before a transaction is opened");
});

test("a decision written for the same instant as the message is a refusal", async () => {
  state.lastDecisionAt = LATER;
  state.lastInboundAt = LATER;

  const result = await review();

  assert.equal(result.ok, false);
  assert.equal(count("insert into mychef_inbox.decision_records"), 0);
});

test("a competing decision that commits before the lock is caught inside the transaction", async () => {
  // Pre-read says open (decision 08:00 < inbound 09:00)...
  state.lastDecisionAt = EARLIER;
  state.lastInboundAt = LATER;
  // ...but by the time the row lock is taken, another actor decided the 09:00 turn.
  state.lockedDecisionAt = new Date("2026-11-01T09:30:00.000Z");
  state.lockedInboundAt = LATER;

  const result = await review();

  assert.equal(result.ok, false, "the second reviewer must be refused, not silently duplicated");
  assert.match(String(result.error), /already decided/i);
  assert.equal(count("insert into mychef_inbox.decision_records"), 0);
  assert.equal(count("insert into mychef_inbox.feedback"), 0);
  assert.equal(count("rollback"), 1);
});

test("the row lock is taken before any write, and on the conversation row", async () => {
  state.lastDecisionAt = EARLIER;
  state.lastInboundAt = LATER;

  const result = await review();
  assert.equal(result.ok, true, result.error);

  const forUpdate = state.log.findIndex((entry) => entry.sql.includes("for update"));
  const feedback = state.log.findIndex((entry) => entry.sql.startsWith("insert into mychef_inbox.feedback"));
  const decision = state.log.findIndex((entry) =>
    entry.sql.startsWith("insert into mychef_inbox.decision_records"),
  );
  const begin = state.log.findIndex((entry) => entry.sql === "begin");

  assert.ok(begin >= 0, "transaction opened");
  assert.ok(forUpdate > begin, "lock inside the transaction");
  assert.ok(forUpdate < feedback, "lock before the feedback write");
  assert.ok(forUpdate < decision, "lock before the decision write");
  assert.match(state.log[forUpdate]?.sql ?? "", /from mychef_inbox\.conversations/);
  assert.match(state.log[forUpdate]?.sql ?? "", /for update$/);
});

test("every statement stays inside the one workspace — no id is trusted from the caller", async () => {
  state.lastDecisionAt = EARLIER;
  state.lastInboundAt = LATER;

  await review();

  const writes = state.log.filter((entry) => entry.sql.startsWith("insert into"));
  assert.ok(writes.length >= 3, "feedback, decision, audit at minimum");
  for (const write of writes) {
    assert.equal(write.params[0], "mychef", `workspace must be bound first: ${write.sql.slice(0, 60)}`);
  }
});
