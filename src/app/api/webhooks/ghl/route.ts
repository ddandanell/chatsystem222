/**
 * GHL inbound stub. Writes contacts, conversations, messages, drafts, webhook_receipts. Do not auto-send.
 *
 * Order matters: the raw body is read first so a signature can be verified over the exact bytes that
 * arrived, then authorisation runs before the body is parsed or any database work starts.
 *
 * A failure after authentication returns 500 (retryable) and writes a receipt under a key derived
 * from the body, so a retrying sender collapses onto one row. The previous behaviour returned 202
 * on a database error, which told GHL the event had been accepted when nothing had been stored.
 */
import { appPool } from "@/db/client";
import { applyGhlPayload, authorizeGhl, errorReceiptKey } from "@/lib/ghl-inbound";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = authorizeGhl(request.headers, rawBody);
  if (!auth.ok) {
    // 503 means the endpoint is not configured; 401 means a presented credential was refused.
    return Response.json(
      { ok: false, sent: false, duplicate: false, error: auth.reason },
      { status: auth.status },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json(
      { ok: false, sent: false, duplicate: false, error: "Send a JSON body." },
      { status: 400 },
    );
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
        duplicate: result.duplicate,
        conversationId: result.conversationId,
        verified: auth.verified,
        verification: auth.mode,
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
    // Record the failure under a deterministic key. Never echo a secret or a connection string.
    try {
      const receiptClient = await appPool.connect();
      try {
        await receiptClient.query(
          `insert into mychef_inbox.webhook_receipts (event_key, workspace_id, payload)
           values ($1, 'mychef', $2::jsonb)
           on conflict (event_key) do update set payload = excluded.payload, received_at = now()`,
          [
            errorReceiptKey(rawBody),
            JSON.stringify({
              source: "ghl",
              verified: auth.verified,
              fit: false,
              draftCreated: false,
              duplicate: false,
              retryable: true,
              detail:
                error instanceof Error
                  ? error.message.split("\n")[0].slice(0, 300)
                  : "The event did not fit the inbox tables.",
            }),
          ],
        );
      } finally {
        receiptClient.release();
      }
    } catch {
      // A failure to log is still a failure to store: the 500 below remains truthful.
    }
    return Response.json(
      {
        ok: false,
        fit: false,
        duplicate: false,
        retryable: true,
        sent: false,
        detail: "The event was not stored. It is safe for the sender to retry.",
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
