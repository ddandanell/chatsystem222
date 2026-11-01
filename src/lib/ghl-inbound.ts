/**
 * Parses a GHL payload into mychef_inbox rows and a local draft. Do not auto-send.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { inboundFromGhl } from "@/channels/inbound";
import { recordAutoSendCandidateIfEnabled } from "@/lib/autopilot";
import { localStructuredDraft } from "@/lib/draft";
import { authorizeWebhook, type WebhookAuthResult } from "@/lib/webhook-auth";

const WORKSPACE = "mychef";

export type GhlResult = {
  status: number;
  eventKey: string;
  fit: boolean;
  draftCreated: boolean;
  conversationId: string | null;
  detail: string;
};

export function authorizeGhl(headers: Headers): WebhookAuthResult {
  // Fail closed. A missing secret is a configuration fault, not an open door.
  return authorizeWebhook(headers);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseGhlMessage(payload: unknown): {
  body: string;
  contactId: string;
  contactName: string;
  conversationId: string;
  messageId: string;
  locationId: string;
} {
  const root = asRecord(payload);
  const message = asRecord(root.message);
  const contact = asRecord(root.contact);
  const body =
    textOf(root.body) ||
    textOf(root.text) ||
    textOf(message.body) ||
    textOf(message.text) ||
    textOf(asRecord(root.payload).body);
  return {
    body,
    contactId: textOf(root.contactId) || textOf(contact.id),
    contactName: textOf(root.contactName) || textOf(contact.name) || textOf(root.name) || "GHL contact",
    conversationId: textOf(root.conversationId) || textOf(asRecord(root.conversation).id),
    messageId: textOf(root.messageId) || textOf(message.id) || textOf(root.id),
    locationId: textOf(root.locationId),
  };
}

function safeId(value: string, prefix: string): string {
  if (/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) return value;
  const hash = createHash("sha256").update(`${prefix}:${value}`).digest("hex").slice(0, 24);
  return `${prefix}${hash}`;
}

function kindForTitle(title: string): "position" | "playbook" {
  return /TEMPLATE|TONE|QUICK_START|SYSTEM_PROMPT|README/i.test(title) ? "playbook" : "position";
}

async function writeReceipt(
  client: pg.PoolClient,
  eventKey: string,
  payload: Record<string, unknown>,
) {
  await client.query(
    `insert into mychef_inbox.webhook_receipts (event_key, workspace_id, payload)
     values ($1, $2, $3::jsonb)
     on conflict (event_key) do update
       set payload = excluded.payload, received_at = now()`,
    [eventKey, WORKSPACE, JSON.stringify(payload)],
  );
}

export async function applyGhlPayload(
  client: pg.PoolClient,
  payload: unknown,
  verified: boolean,
): Promise<GhlResult> {
  const parsed = parseGhlMessage(payload);
  const inbound = inboundFromGhl(parsed);
  const eventKey = `ghl:${safeId(parsed.messageId || parsed.body.slice(0, 80) || "empty", "evt-")}`.slice(0, 180);
  if (!parsed.body) {
    await writeReceipt(client, eventKey, {
      source: "ghl",
      verified,
      fit: false,
      draftCreated: false,
      detail: "No message body was found. Nothing was drafted and nothing was sent.",
    });
    return {
      status: 202,
      eventKey,
      fit: false,
      draftCreated: false,
      conversationId: null,
      detail: "No message body was found.",
    };
  }

  const contactId = safeId(parsed.contactId || "unknown", "ghl-contact-");
  const conversationId = safeId(parsed.conversationId || contactId, "ghl-conv-");
  const messageId = safeId(parsed.messageId || `${conversationId}:${parsed.body.slice(0, 40)}`, "ghl-msg-");

  await client.query(
    `insert into mychef_inbox.contacts (workspace_id, id, name, facts)
     values ($1, $2, $3, '{}'::jsonb)
     on conflict (workspace_id, id) do update set name = excluded.name`,
    [WORKSPACE, contactId, parsed.contactName.slice(0, 200)],
  );
  await client.query(
    `insert into mychef_inbox.conversations
       (workspace_id, id, contact_id, channel, status, last_message_at, project_id, location_id)
     values ($1, $2, $3, $5, 'needs_reply', now(), 'mychef', $4)
     on conflict (workspace_id, id) do update
       set status = 'needs_reply',
           last_message_at = now(),
           contact_id = excluded.contact_id,
           location_id = coalesce(excluded.location_id, mychef_inbox.conversations.location_id)`,
    [WORKSPACE, conversationId, contactId, inbound.locationId || null, inbound.channel],
  );
  const inserted = await client.query(
    `insert into mychef_inbox.messages
       (workspace_id, id, conversation_id, direction, body, attachments, created_at)
     values ($1, $2, $3, 'inbound', $4, '[]'::jsonb, now())
     on conflict (workspace_id, id) do nothing
     returning id`,
    [WORKSPACE, messageId, conversationId, parsed.body.slice(0, 8000)],
  );

  let draftCreated = false;
  if ((inserted.rowCount ?? 0) > 0) {
    const docs = await client.query<{ id: string; title: string; content: string }>(
      `select id, title, content from mychef_inbox.knowledge
       where workspace_id = $1 and source not in ('ledger-rule', 'learning-pass')`,
      [WORKSPACE],
    );
    const knowledge = docs.rows.slice(0, 8).map((doc) => ({
      chunkId: doc.id,
      orgId: WORKSPACE,
      sourceId: doc.id,
      title: doc.title,
      kind: kindForTitle(doc.title),
      excerpt: doc.content.slice(0, 700),
      score: doc.title.toLowerCase().includes("pric") ? 0.4 : 0.2,
    }));
    const draft = localStructuredDraft(parsed.body, knowledge, []);
    await client.query(
      `insert into mychef_inbox.drafts
         (workspace_id, conversation_id, body, author_id, kind, based_on_message_id, model, source_ids, prompt_version)
       values ($1, $2, $3, 'ghl-webhook', 'ai', $4, 'local', $5::jsonb, $6)`,
      [
        WORKSPACE,
        conversationId,
        draft.draftText,
        messageId,
        JSON.stringify(draft.sourceRefs),
        JSON.stringify({ confidence: draft.confidence, why: draft.why, escalate: draft.escalate, channel: inbound.channel }),
      ],
    );
    await client.query("savepoint autopilot");
    try {
      const auto = await recordAutoSendCandidateIfEnabled(client, {
        conversationId,
        projectId: "mychef",
        authorId: "ghl-webhook",
        draftText: draft.draftText,
        confidence: draft.confidence,
        escalate: draft.escalate,
        sourceRefs: draft.sourceRefs,
      });
      if (auto.fired) {
        await writeReceipt(client, eventKey, {
          source: "ghl",
          verified,
          fit: true,
          draftCreated: true,
          conversationId,
          detail: "Inbound stored. Auto-pilot marked auto_sent_candidate. Sending is not connected.",
          excerpt: parsed.body.slice(0, 160),
        });
        return {
          status: 200,
          eventKey,
          fit: true,
          draftCreated: true,
          conversationId,
          detail: "Stored. Sending is not connected.",
        };
      }
    } catch {
      await client.query("rollback to savepoint autopilot");
    }
    draftCreated = true;
  }

  await writeReceipt(client, eventKey, {
    source: "ghl",
    verified,
    fit: true,
    draftCreated,
    conversationId,
    detail: draftCreated
      ? "Inbound stored and a local draft is pending. Nothing was sent."
      : "This message was already stored. No second draft was created. Nothing was sent.",
    excerpt: parsed.body.slice(0, 160),
  });

  return {
    status: 200,
    eventKey,
    fit: true,
    draftCreated,
    conversationId,
    detail: "Stored. Nothing was sent.",
  };
}
