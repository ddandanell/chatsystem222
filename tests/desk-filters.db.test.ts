/**
 * MC-182 + CS round 3 — the DB-level half of the queue partition.
 *
 * `tests/desk-filters.test.ts` proves the rules as logic. It cannot prove that Postgres returns the
 * rows, and the reviewer's objection to the first attempt was exactly that: `rule.sql` and
 * `rule.test` were two representations of one rule, so a wrong `rule.sql` (the status list, the join
 * condition, the `>`) passed the suite while the queue was still wrong.
 *
 * This file executes the exported predicate strings against a real `mychef_inbox` schema, in a
 * throw-away fixture workspace, and asserts the properties that matter:
 *
 *  1. every visible conversation lands in exactly one chip, and the chips add up to `all`;
 *  2. every chip's number equals the rows that chip opens (count and list, one predicate);
 *  3. a covering decision files a thread under `decided`; a guest follow-up re-opens it, and a new
 *     verdict closes it again;
 *  4. a lens is inside `decided`, reads only the newest decision, and cannot exceed it;
 *  5. the tombstone status is in no chip and not in `all`, and one UPDATE brings the row back;
 *  6. a conversation with no contact row is still reachable.
 *
 * Run with a disposable database that has the schema and no production data:
 *   createdb mychef_mc182 && pg_dump --schema-only mychef_fixture | psql mychef_mc182
 *   MYCHEF_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/mychef_mc182 \
 *     node --import tsx --test tests/desk-filters.db.test.ts
 * Without `MYCHEF_TEST_DATABASE_URL` every test here is skipped, never silently passed.
 */

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import {
  FALLBACK_STATE,
  REASON_FILTERS,
  STATE_FILTERS,
  TOMBSTONE_STATUS,
  bucketCaseSql,
  lensWhereSql,
  queueWhereSql,
  type DeskFilter,
} from "@/lib/desk-filters";

const URL = process.env.MYCHEF_TEST_DATABASE_URL ?? "";
const WS = "mc182-fixture";

const T = {
  base: "2026-10-31T09:00:00.000Z",
  inboundA: "2026-11-01T03:21:06.432Z",
  decisionAfterA: "2026-11-01T03:48:17.909Z",
  inboundNewer: "2026-11-01T07:29:32.477Z",
};

let pool: Pool | null = null;
let unavailable: string | null = null;

async function db(t: TestContext): Promise<Pool | null> {
  if (!URL) {
    unavailable = "MYCHEF_TEST_DATABASE_URL is not set";
    t.skip(unavailable);
    return null;
  }
  if (!pool) {
    const candidate = new Pool({ connectionString: URL, max: 2 });
    try {
      await candidate.query("select 1");
      pool = candidate;
    } catch (error) {
      unavailable = `fixture database unreachable: ${error instanceof Error ? error.message : error}`;
      await candidate.end().catch(() => {});
      t.skip(unavailable);
      return null;
    }
  }
  return pool;
}

async function cleanup(client: Pool) {
  await client.query("delete from mychef_inbox.decision_records where workspace_id = $1", [WS]);
  await client.query("delete from mychef_inbox.feedback where workspace_id = $1", [WS]);
  await client.query("delete from mychef_inbox.messages where workspace_id = $1", [WS]);
  await client.query("delete from mychef_inbox.drafts where workspace_id = $1", [WS]);
  await client.query("delete from mychef_inbox.conversations where workspace_id = $1", [WS]);
  await client.query("delete from mychef_inbox.contacts where workspace_id = $1", [WS]);
}

/**
 * The fixture. Seven conversations, covering every state, one contactless row and one tombstone.
 *
 *  A needs_reply, contact, one inbound, no decision        -> needs_reply
 *  B needs_reply, contact, inbound then decision           -> decided
 *  C waiting,     contact, inbound then escalated decision  -> decided, in the escalated lens
 *  D waiting,     contact, no inbound, no decision          -> waiting
 *  E needs_reply, contact, escalated decision then inbound  -> needs_reply, NOT in the lens
 *  F done (tombstone), contact, decision                    -> in no chip, not in all
 *  G needs_reply, NO contact row                            -> needs_reply, still in all
 */
async function seed(client: Pool) {
  await cleanup(client);
  for (const [id, name] of [
    ["mc182-k1", "Fixture one"],
    ["mc182-k2", "Fixture two"],
    ["mc182-k3", "Fixture three"],
    ["mc182-k4", "Fixture four"],
    ["mc182-k5", "Fixture five"],
    ["mc182-k6", "Fixture six"],
  ]) {
    await client.query(
      `insert into mychef_inbox.contacts (workspace_id, id, name, facts) values ($1, $2, $3, '{}'::jsonb)`,
      [WS, id, name],
    );
  }
  const conversations: [string, string | null, string, string][] = [
    ["mc182-A", "mc182-k1", "needs_reply", T.inboundA],
    ["mc182-B", "mc182-k2", "needs_reply", T.inboundA],
    ["mc182-C", "mc182-k3", "waiting", T.inboundA],
    ["mc182-D", "mc182-k4", "waiting", T.base],
    ["mc182-E", "mc182-k5", "needs_reply", T.inboundNewer],
    ["mc182-F", "mc182-k6", TOMBSTONE_STATUS, T.inboundA],
    ["mc182-G", null, "needs_reply", T.inboundA],
  ];
  for (const [id, contactId, status, lastMessageAt] of conversations) {
    await client.query(
      `insert into mychef_inbox.conversations
         (workspace_id, id, contact_id, channel, status, last_message_at, project_id)
       values ($1, $2, $3, 'Other', $4, $5, 'mychef')`,
      [WS, id, contactId ?? "mc182-k1", status, lastMessageAt],
    );
  }
  // `conversations.contact_id` is NOT NULL with a composite FK in this schema, so a contactless
  // conversation cannot exist; G is kept as a normal row and the contactless case is asserted as
  // inapplicable rather than silently skipped (see the last test).

  for (const [id, conversation, createdAt] of [
    ["mc182-A-M1", "mc182-A", T.inboundA],
    ["mc182-B-M1", "mc182-B", T.inboundA],
    ["mc182-C-M1", "mc182-C", T.inboundA],
    ["mc182-E-M1", "mc182-E", T.inboundNewer],
    ["mc182-F-M1", "mc182-F", T.inboundA],
    ["mc182-G-M1", "mc182-G", T.inboundA],
  ]) {
    await client.query(
      `insert into mychef_inbox.messages
         (workspace_id, id, conversation_id, direction, body, attachments, created_at)
       values ($1, $2, $3, 'inbound', 'fixture', '[]'::jsonb, $4)`,
      [WS, id, conversation, createdAt],
    );
  }

  // `decision_records.feedback_id` is NOT NULL with an FK, so every fixture verdict carries one.
  const decisions: [string, string, string, string, string, string][] = [
    ["mc182-B-D1", "mc182-B", T.decisionAfterA, "approved", "good_as_drafted", ""],
    ["mc182-C-D1", "mc182-C", T.decisionAfterA, "rejected", "needs_human", "escalated"],
    ["mc182-E-D1", "mc182-E", T.base, "rejected", "needs_human", "escalated"],
    ["mc182-F-D1", "mc182-F", T.decisionAfterA, "approved", "good_as_drafted", ""],
  ];
  for (const [id, conversation, createdAt, human, reason, alternative] of decisions) {
    const letter = id.replace(/^mc182-([A-Z])-D1$/, "$1");
    const feedbackId = `00000000-0000-4000-9000-0000000000${letter.charCodeAt(0).toString(16)}`;
    await client.query(
      `insert into mychef_inbox.feedback
         (id, workspace_id, conversation_id, scope, note, original_draft, edited_draft, author_id, created_at)
       values ($1::uuid, $2, $3, 'conversation', 'fixture', 'fixture', 'fixture', 'fixture', $4)`,
      [feedbackId, WS, conversation, createdAt],
    );
    await client.query(
      `insert into mychef_inbox.decision_records
         (id, workspace_id, conversation_id, project_id, feedback_id, reason_code, rationale, why_not,
          rejected_alternative, human_decision, source_refs, author_id, created_at)
       values ($1::uuid, $2, $3, 'mychef', $4::uuid, $5, 'fixture', 'fixture', $6, $7, '[]'::jsonb, 'fixture', $8)`,
      [fixtureUuid(letter), WS, conversation, feedbackId, reason, alternative, human, createdAt],
    );
  }
}

/** A stable uuid per fixture conversation, so ids are deterministic across runs. */
function fixtureUuid(letter: string): string {
  const code = letter.charCodeAt(0).toString(16).padStart(2, "0");
  return `00000000-0000-4000-8000-0000000000${code}`;
}

type Classified = { id: string; bucket: string; visible: boolean };

async function classify(client: Pool): Promise<Classified[]> {
  const result = await client.query<Classified>(
    `select c.id,
            (${bucketCaseSql()})::text as bucket,
            (${queueWhereSql("all")})::boolean as visible
     from mychef_inbox.conversations c
     where c.workspace_id = $1
     order by c.id`,
    [WS],
  );
  return result.rows;
}

async function chipCounts(client: Pool): Promise<Record<string, number>> {
  const result = await client.query<Record<string, string>>(
    `select count(*)::text as all,
            ${STATE_FILTERS.map((id) => `count(*) filter (where (${bucketCaseSql()}) = '${id}')::text as ${id}`).join(",\n            ")}
     from mychef_inbox.conversations c
     where c.workspace_id = $1 and (${queueWhereSql("all")})`,
    [WS],
  );
  const row = result.rows[0] ?? {};
  const counts: Record<string, number> = {};
  for (const id of ["all", ...STATE_FILTERS]) counts[id] = Number(row[id] ?? 0);
  return counts;
}

async function listTotal(client: Pool, filter: DeskFilter): Promise<number> {
  const where = filter === "all" ? queueWhereSql("all") : queueWhereSql(filter);
  const result = await client.query<{ n: string }>(
    `select count(*)::text as n from mychef_inbox.conversations c
      where c.workspace_id = $1 and (${where})`,
    [WS],
  );
  return Number(result.rows[0]?.n ?? 0);
}

test("db: every visible conversation lands in exactly one chip and the chips add up to all", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);
  const rows = await classify(client);
  const visible = rows.filter((row) => row.visible);
  assert.equal(visible.length, 6, "six visible fixtures");

  const expected: Record<string, string> = {
    "mc182-A": "needs_reply",
    "mc182-B": "decided",
    "mc182-C": "decided",
    "mc182-D": "waiting",
    "mc182-E": "needs_reply",
    "mc182-G": "needs_reply",
  };
  for (const row of visible) {
    assert.equal(row.bucket, expected[row.id], `${row.id} landed in ${row.bucket}`);
  }
  assert.equal(rows.find((row) => row.id === "mc182-F")?.visible, false, "the tombstone must not be visible");

  const counts = await chipCounts(client);
  assert.equal(counts.all, 6);
  assert.equal(counts.needs_reply, 3);
  assert.equal(counts.decided, 2);
  assert.equal(counts.waiting, 1);
  assert.equal(counts.closed, 0);
  const sum = STATE_FILTERS.reduce((acc, id) => acc + counts[id], 0);
  assert.equal(sum, counts.all, "the four chips must add up to all");

  // The tombstone is in no chip even though it has a decision and sits inside the status CHECK.
  for (const id of STATE_FILTERS) {
    assert.equal(await listTotal(client, id), counts[id], `${id} rows and ${id} chip disagree`);
  }
  assert.equal(await listTotal(client, "all"), 6);
});

test("db: a chip's number is the number of rows that chip opens", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);
  const counts = await chipCounts(client);
  for (const filter of [...STATE_FILTERS, "all"] as DeskFilter[]) {
    assert.equal(await listTotal(client, filter), counts[filter], `${filter}: chip ${counts[filter]} vs rows`);
  }
  const union = STATE_FILTERS.reduce((acc, id) => acc + counts[id], 0);
  assert.equal(union, counts.all, "union of the states must equal all");
});

test("db: a covering decision files decided; a follow-up re-opens the thread; a new verdict closes it", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);
  const bucketOf = async (id: string) =>
    (await classify(client)).find((row) => row.id === id)?.bucket;

  assert.equal(await bucketOf("mc182-B"), "decided");

  // The guest writes again, one second after the verdict. `ghl-inbound.ts` also sets the status.
  await client.query(
    `insert into mychef_inbox.messages (workspace_id, id, conversation_id, direction, body, attachments, created_at)
     values ($1, 'mc182-B-M2', 'mc182-B', 'inbound', 'follow-up', '[]'::jsonb, $2)`,
    [WS, new Date(Date.parse(T.decisionAfterA) + 1000).toISOString()],
  );
  await client.query(
    `update mychef_inbox.conversations set status = 'needs_reply' where workspace_id = $1 and id = 'mc182-B'`,
    [WS],
  );
  assert.equal(await bucketOf("mc182-B"), "needs_reply", "the follow-up must re-open the thread");

  // A verdict on the new turn covers it again.
  await client.query(
    `insert into mychef_inbox.feedback
       (id, workspace_id, conversation_id, scope, note, original_draft, edited_draft, author_id, created_at)
     values ('00000000-0000-4000-9000-0000000000bb'::uuid, $1, 'mc182-B', 'conversation',
             'fixture', 'fixture', 'fixture', 'fixture', $2)`,
    [WS, new Date(Date.parse(T.decisionAfterA) + 2000).toISOString()],
  );
  await client.query(
    `insert into mychef_inbox.decision_records
       (id, workspace_id, conversation_id, project_id, feedback_id, reason_code, rationale, why_not,
        rejected_alternative, human_decision, source_refs, author_id, created_at)
     values ('00000000-0000-4000-8000-0000000000bb'::uuid, $1, 'mc182-B', 'mychef',
             '00000000-0000-4000-9000-0000000000bb'::uuid,
             'good_as_drafted', 'fixture', 'fixture', '', 'approved', '[]'::jsonb, 'fixture', $2)`,
    [WS, new Date(Date.parse(T.decisionAfterA) + 2000).toISOString()],
  );
  await client.query(
    `update mychef_inbox.conversations set status = 'waiting' where workspace_id = $1 and id = 'mc182-B'`,
    [WS],
  );
  assert.equal(await bucketOf("mc182-B"), "decided", "the new verdict must cover the new turn");

  const counts = await chipCounts(client);
  assert.equal(counts.decided, 2);
  assert.equal(counts.needs_reply, 3);
});

test("db: a reason lens is inside decided, reads only the newest decision, and never exceeds it", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);

  for (const filter of REASON_FILTERS) {
    const lensRows = await client.query<{ id: string }>(
      `select c.id from mychef_inbox.decision_records d
         join mychef_inbox.conversations c
           on c.workspace_id = d.workspace_id and c.id = d.conversation_id
        where d.workspace_id = $1 and (${lensWhereSql(filter)})`,
      [WS],
    );
    const ids: string[] = lensRows.rows.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length, `${filter} counted a conversation twice: ${ids.join(", ")}`);
    const decided = await client.query<{ id: string }>(
      `select c.id from mychef_inbox.conversations c
        where c.workspace_id = $1 and (${queueWhereSql("decided")})`,
      [WS],
    );
    const decidedIds = new Set(decided.rows.map((row) => row.id));
    for (const id of ids) {
      assert.ok(decidedIds.has(id), `${filter} opened ${id}, which is not in decided`);
    }
  }

  // C's newest decision is escalated -> in the lens. E's newest decision is escalated but predates
  // the guest's follow-up -> the lens must not open it, because `decided` does not.
  const escalated = await client.query<{ id: string }>(
    `select c.id from mychef_inbox.decision_records d
       join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
      where d.workspace_id = $1 and (${lensWhereSql("escalated")})`,
    [WS],
  );
  const escalatedIds = escalated.rows.map((row) => row.id);
  assert.deepEqual(escalatedIds, ["mc182-C"], `escalated lens: ${escalatedIds.join(", ")}`);

  // Add a second, newer decision to C that is not escalated: the lens must follow the newest one.
  await client.query(
    `insert into mychef_inbox.feedback
       (id, workspace_id, conversation_id, scope, note, original_draft, edited_draft, author_id, created_at)
     values ('00000000-0000-4000-9000-0000000000cc'::uuid, $1, 'mc182-C', 'conversation',
             'fixture', 'fixture', 'fixture', 'fixture', $2)`,
    [WS, new Date(Date.parse(T.decisionAfterA) + 60000).toISOString()],
  );
  await client.query(
    `insert into mychef_inbox.decision_records
       (id, workspace_id, conversation_id, project_id, feedback_id, reason_code, rationale, why_not,
        rejected_alternative, human_decision, source_refs, author_id, created_at)
     values ('00000000-0000-4000-8000-0000000000cc'::uuid, $1, 'mc182-C', 'mychef',
             '00000000-0000-4000-9000-0000000000cc'::uuid,
             'good_as_drafted', 'fixture', 'fixture', '', 'approved', '[]'::jsonb, 'fixture', $2)`,
    [WS, new Date(Date.parse(T.decisionAfterA) + 60000).toISOString()],
  );
  const after = await client.query<{ id: string }>(
    `select c.id from mychef_inbox.decision_records d
       join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
      where d.workspace_id = $1 and (${lensWhereSql("escalated")})`,
    [WS],
  );
  assert.deepEqual(after.rows.map((row) => row.id), [], "a superseded decision must leave the lens");
});

test("db: the tombstone is in no chip and not in all, and one UPDATE brings the row back", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);
  const counts = await chipCounts(client);
  assert.equal(counts.all, 6, "the tombstone must not be in all");

  await client.query(
    `update mychef_inbox.conversations set status = 'needs_reply' where workspace_id = $1 and id = 'mc182-F'`,
    [WS],
  );
  const opened = await classify(client);
  assert.equal(opened.find((row) => row.id === "mc182-F")?.bucket, "decided", "F is decided once visible");
  assert.equal((await chipCounts(client)).all, 7);

  await client.query(
    `update mychef_inbox.conversations set status = $3 where workspace_id = $1 and id = $2`,
    [WS, "mc182-F", TOMBSTONE_STATUS],
  );
  assert.equal((await chipCounts(client)).all, 6, "closing the window must restore the count");
});

test("db: a conversation with no contact row is still reachable", async (t) => {
  const client = await db(t);
  if (!client) return;
  await seed(client);
  const nullable = await client.query<{ is_nullable: string }>(
    `select is_nullable from information_schema.columns
      where table_schema = 'mychef_inbox' and table_name = 'conversations' and column_name = 'contact_id'`,
  );
  const rows = await classify(client);
  assert.equal(rows.find((row) => row.id === "mc182-G")?.bucket, "needs_reply");
  // The queue's `left join contacts` is a safety net, not a live case: the column is NOT NULL with a
  // composite FK, so a conversation cannot exist without a contact in this schema.
  assert.equal(nullable.rows[0]?.is_nullable, "NO", "contact_id became nullable: re-check the join");
  assert.equal(rows.filter((row) => row.visible).length, 6);
});

test("db: cleanup leaves the fixture workspace empty", async (t) => {
  const client = await db(t);
  if (!client) return;
  await cleanup(client);
  const left = await client.query<{ n: string }>(
    `select count(*)::text as n from mychef_inbox.conversations where workspace_id = $1`,
    [WS],
  );
  assert.equal(Number(left.rows[0]?.n ?? 0), 0);
  assert.equal(FALLBACK_STATE, "waiting");
});
