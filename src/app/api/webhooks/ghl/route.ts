/**
 * GHL inbound stub. Writes contacts, conversations, messages, drafts, webhook_receipts. Do not auto-send.
 */
import { appPool } from "@/db/client";
import { applyGhlPayload, authorizeGhl } from "@/lib/ghl-inbound";

export async function POST(request: Request) {
  const auth = authorizeGhl(request.headers);
  if (!auth.ok) {
    // 503 means the endpoint is not configured; 401 means a presented secret was refused.
    return Response.json({ ok: false, sent: false, error: auth.reason }, { status: auth.status });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }

  const client = await appPool.connect();
  try {
    await client.query("begin");
    const result = await applyGhlPayload(client, payload, auth.verified);
    await client.query("commit");
    return Response.json(
      {
        ok: true,
        eventKey: result.eventKey,
        fit: result.fit,
        draftCreated: result.draftCreated,
        conversationId: result.conversationId,
        detail: result.detail,
        sent: false,
      },
      { status: result.status },
    );
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // The insert never started a transaction.
    }
    const clientForReceipt = await appPool.connect();
    try {
      await clientForReceipt.query(
        `insert into mychef_inbox.webhook_receipts (event_key, workspace_id, payload)
         values ($1, 'mychef', $2::jsonb)
         on conflict (event_key) do update set payload = excluded.payload, received_at = now()`,
        [
          `ghl:error-${Date.now()}`,
          JSON.stringify({
            source: "ghl",
            verified: auth.verified,
            fit: false,
            draftCreated: false,
            detail: error instanceof Error ? error.message.split("\n")[0] : "The event did not fit the inbox tables.",
          }),
        ],
      );
    } finally {
      clientForReceipt.release();
    }
    return Response.json(
      { ok: false, fit: false, sent: false, detail: "The event was logged and nothing was sent." },
      { status: 202 },
    );
  } finally {
    client.release();
  }
}
