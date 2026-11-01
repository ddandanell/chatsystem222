/**
 * Tests for the GHL inbound path: retrieval policy and idempotency.
 *
 * No database, no network, no provider call. The fake client deliberately returns knowledge rows
 * that the real SQL would have filtered out, so these tests prove the second line of defence: even
 * if a query regresses, `rankKnowledgeRows()` still keeps pending, foreign and candidate text out of
 * the draft a reviewer opens first.
 *
 * The webhook path used to select `where workspace_id = $1` and take the first eight rows. On the
 * live database that was 12 rows: 12 unapproved, 4 from another project.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { applyGhlPayload, errorReceiptKey } from "@/lib/ghl-inbound";
import { RETRIEVAL_POLICY_VERSION } from "@/lib/retrieval-policy";

type Row = Record<string, unknown>;

type Call = { text: string; params: unknown[] };

const KNOWLEDGE_ROWS: Row[] = [
  {
    id: "k-ok",
    title: "Deposit and cancellation",
    content: "Deposits are refundable up to 14 days before the dinner. Inside 14 days the deposit is not refundable.",
    status: "approved",
    source: "import",
    project_id: "mychef",
    workspace_id: "mychef",
  },
  {
    id: "k-pending",
    title: "Draft pricing sheet",
    content: "Unapproved price: 900 000 IDR per person.",
    status: "pending",
    source: "import",
    project_id: "mychef",
    workspace_id: "mychef",
  },
  {
    id: "k-foreign",
    title: "Other project policy",
    content: "Another project's cancellation window is 48 hours.",
    status: "approved",
    source: "import",
    project_id: "other-project",
    workspace_id: "mychef",
  },
  {
    id: "k-candidate",
    title: "Learning pass suggestion",
    content: "A candidate rule that no human has published.",
    status: "approved",
    source: "learning-pass",
    project_id: "mychef",
    workspace_id: "mychef",
  },
];

const COUNT_GROUPS: Row[] = [
  { status: "approved", source: "import", project_id: "mychef", workspace_id: "mychef", n: 1 },
  { status: "pending", source: "import", project_id: "mychef", workspace_id: "mychef", n: 1 },
  { status: "approved", source: "import", project_id: "other-project", workspace_id: "mychef", n: 1 },
  { status: "approved", source: "learning-pass", project_id: "mychef", workspace_id: "mychef", n: 1 },
];

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function fakeClient(options: { messageRows?: number; knowledge?: Row[]; counts?: Row[] } = {}) {
  const calls: Call[] = [];
  const drafts: unknown[][] = [];
  const receipts: unknown[][] = [];
  let messageRows = options.messageRows ?? 1;
  const knowledge = options.knowledge ?? KNOWLEDGE_ROWS;
  const counts = options.counts ?? COUNT_GROUPS;

  const client = {
    calls,
    drafts,
    receipts,
    setMessageRows(next: number) {
      messageRows = next;
    },
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      const sql = normalize(text);
      if (sql.includes("insert into mychef_inbox.webhook_receipts")) {
        receipts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("insert into mychef_inbox.messages")) {
        return messageRows > 0
          ? { rows: [{ id: params[1] }], rowCount: messageRows }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("insert into mychef_inbox.drafts")) {
        drafts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("select status, source, project_id")) {
        return { rows: counts, rowCount: counts.length };
      }
      if (sql.includes("from mychef_inbox.knowledge")) {
        return { rows: knowledge, rowCount: knowledge.length };
      }
      if (sql.includes("from mychef_inbox.integration_connections")) {
        // Autopilot is off: the default; sending is not connected.
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return client;
}

const PAYLOAD = {
  messageId: "ghl-msg-1",
  contactId: "contact-1",
  conversationId: "conv-1",
  body: "Can we move dinner to 8pm, and what happens to the deposit if we cancel?",
};

async function apply(client: ReturnType<typeof fakeClient>, payload: unknown = PAYLOAD) {
  return applyGhlPayload(client as unknown as pg.PoolClient, payload, true);
}

test("the webhook draft quotes only approved, in-project knowledge", async () => {
  const client = fakeClient();
  const result = await apply(client);
  assert.equal(result.draftCreated, true);
  assert.equal(client.drafts.length, 1);

  const params = client.drafts[0];
  const sourcePayload = JSON.parse(String(params[4])) as {
    sources: { id: string }[];
    retrieval: { policyVersion: string; eligible: number; excluded: Record<string, number> };
  };
  const ids = sourcePayload.sources.map((source) => source.id);
  assert.deepEqual(ids, ["k-ok"], "only the approved, in-project row may be quoted");

  const serialized = JSON.stringify(params);
  for (const forbidden of ["k-pending", "k-foreign", "k-candidate", "900 000 IDR", "48 hours"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not reach the draft`);
  }
});

test("the webhook draft records the retrieval policy version and the withheld counts", async () => {
  const client = fakeClient();
  await apply(client);
  const promptVersion = JSON.parse(String(client.drafts[0][5])) as {
    retrieval: {
      policyVersion: string;
      path: string;
      workspaceId: string;
      projectId: string;
      eligible: number;
      excluded: Record<string, number>;
    };
    channel: string;
  };
  assert.equal(promptVersion.retrieval.policyVersion, RETRIEVAL_POLICY_VERSION);
  assert.equal(promptVersion.retrieval.path, "webhook");
  assert.equal(promptVersion.retrieval.workspaceId, "mychef");
  assert.equal(promptVersion.retrieval.projectId, "mychef");
  assert.equal(promptVersion.retrieval.eligible, 1);
  assert.equal(promptVersion.retrieval.excluded.not_approved, 1);
  assert.equal(promptVersion.retrieval.excluded.other_project, 1);
  assert.equal(promptVersion.retrieval.excluded.candidate_source, 1);
  assert.equal(promptVersion.retrieval.excluded.total, 3);
  assert.equal(promptVersion.channel, "ghl");
});

test("the webhook marks a message with no approved source as needing a person", async () => {
  const client = fakeClient({ knowledge: [KNOWLEDGE_ROWS[1]], counts: [COUNT_GROUPS[1]] });
  await apply(client);
  const promptVersion = JSON.parse(String(client.drafts[0][5])) as { why: string; retrieval: { eligible: number } };
  assert.equal(promptVersion.retrieval.eligible, 0);
  assert.match(promptVersion.why, /No approved knowledge/i);
  assert.match(promptVersion.why, /person should answer/i);
});

test("a repeated delivery creates no second message and no second draft", async () => {
  const client = fakeClient({ messageRows: 1 });
  const first = await apply(client);
  assert.equal(first.draftCreated, true);
  assert.equal(first.duplicate, false);

  client.setMessageRows(0);
  const second = await apply(client);
  assert.equal(second.draftCreated, false);
  assert.equal(second.duplicate, true);
  assert.equal(client.drafts.length, 1, "one event must produce exactly one draft");
  assert.equal(first.eventKey, second.eventKey);

  const keys = client.receipts.map((params) => params[0]);
  assert.equal(new Set(keys).size, 1, "both deliveries must share one receipt key");
  const lastReceipt = JSON.parse(String(client.receipts[client.receipts.length - 1][2])) as {
    duplicate: boolean;
    draftCreated: boolean;
  };
  assert.equal(lastReceipt.duplicate, true);
  assert.equal(lastReceipt.draftCreated, false);
});

test("an event without a body is logged, is not a duplicate, and drafts nothing", async () => {
  const client = fakeClient();
  const result = await apply(client, { messageId: "empty-1" });
  assert.equal(result.status, 202);
  assert.equal(result.fit, false);
  assert.equal(result.duplicate, false);
  assert.equal(result.draftCreated, false);
  assert.equal(client.drafts.length, 0);
  assert.equal(client.receipts.length, 1);
});

test("the receipt records the verified flag it was given", async () => {
  const client = fakeClient();
  await applyGhlPayload(client as unknown as pg.PoolClient, PAYLOAD, false);
  const payload = JSON.parse(String(client.receipts[0][2])) as { verified: boolean };
  assert.equal(payload.verified, false);
});

test("the failure receipt key is derived from the body, so retries collapse onto one row", () => {
  const a = errorReceiptKey('{"a":1}');
  const b = errorReceiptKey('{"a":1}');
  const c = errorReceiptKey('{"a":2}');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^ghl:error-[0-9a-f]{32}$/);
});
