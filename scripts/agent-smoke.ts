/**
 * Local smoke test for the conversation agent: no provider key is configured on the dev database,
 * so this exercises the fallback path and the drafts insert end to end. It cleans up after itself.
 * Not part of the test suite; run manually with `node --env-file=.env.local --import tsx scripts/agent-smoke.ts`.
 */
import { Client } from "pg";
import { agentDraftForConversation } from "@/data/mychef-store";
import { appPool } from "@/db/client";

const connectionString = process.env.DATABASE_URL;

async function main() {
  const probe = new Client({ connectionString });
  await probe.connect();
  const conversations = await probe.query<{ id: string; n: number }>(
    `select c.id, count(m.id)::int as n
     from mychef_inbox.conversations c
     join mychef_inbox.messages m
       on m.workspace_id = c.workspace_id and m.conversation_id = c.id
     where c.workspace_id = 'mychef' and m.direction = 'inbound'
     group by c.id
     order by count(m.id) desc
     limit 1`,
  );
  await probe.end();
  const target = conversations.rows[0];
  if (!target) {
    console.log("no conversation with an inbound message in the dev database");
    return;
  }
  const before = await countDrafts(target.id);
  const result = await agentDraftForConversation(
    target.id,
    "qa.reviewer@mychef.id",
    "Keep it short.",
  );
  if (!result.ok) {
    console.log("REFUSED", result.error);
    await appPool.end();
    return;
  }
  const after = await countDrafts(target.id);
  console.log("conversation", target.id);
  console.log("drafts before/after", before, after);
  console.log("provider", result.agent.provider, "model", result.agent.model, "fellBack", result.agent.fellBack);
  console.log("escalate", result.agent.escalate, "sources", result.agent.sourceRefs.length);
  console.log("draft:", result.agent.draftText);
  console.log("notice:", result.agent.notice);
  const inspect = new Client({ connectionString });
  await inspect.connect();
  const row = await inspect.query<{ model: string; prompt_version: string; source_ids: unknown }>(
    `select model, prompt_version, source_ids from mychef_inbox.drafts
     where workspace_id = 'mychef' and conversation_id = $1
     order by created_at desc limit 1`,
    [target.id],
  );
  console.log("stored model:", row.rows[0]?.model);
  console.log("stored prompt_version:", row.rows[0]?.prompt_version?.slice(0, 160));
  const cleanup = await inspect.query(
    `delete from mychef_inbox.drafts
     where workspace_id = 'mychef' and conversation_id = $1 and created_at > now() - interval '2 minutes'`,
    [target.id],
  );
  console.log("cleaned up rows:", cleanup.rowCount);
  await inspect.end();
  await appPool.end();
}

async function countDrafts(conversationId: string) {
  const client = new Client({ connectionString });
  await client.connect();
  const result = await client.query<{ n: number }>(
    `select count(*)::int as n from mychef_inbox.drafts
     where workspace_id = 'mychef' and conversation_id = $1`,
    [conversationId],
  );
  await client.end();
  return result.rows[0]?.n ?? 0;
}

main().catch(async (error) => {
  console.log("FAILED", error instanceof Error ? error.message : error);
  try {
    await appPool.end();
  } catch {
    // ignore
  }
});
