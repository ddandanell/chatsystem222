/**
 * Parses a GHL payload into mychef_inbox rows and a local draft. Do not auto-send.
 *
 * Retrieval: this path uses the same approval-gated, project-scoped knowledge read as the
 * interactive draft (`rankKnowledgeFromDatabase`), and records the retrieval policy version and the
 * withheld counts in `drafts.prompt_version`. It previously selected knowledge by workspace alone,
 * which on the live database meant a reviewer could be shown pending and other-project text.
 *
 * Idempotency: one inbound message id produces one message row and one draft. A repeated delivery
 * returns `duplicate: true` and creates nothing.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { inboundFromGhl } from "@/channels/inbound";
import { recordAutoSendCandidateIfEnabled } from "@/lib/autopilot";
import { localStructuredDraft } from "@/lib/draft";
import { rankKnowledgeFromDatabase } from "@/lib/knowledge-retrieval";
import {
  MYCHEF_RETRIEVAL_SCOPE,
  RETRIEVAL_POLICY_VERSION,
  retrievalNotice,
} from "@/lib/retrieval-policy";
import { authorizeWebhook, type WebhookAuthResult } from "@/lib/webhook-auth";

const WORKSPACE = "mychef";

/** At most four quoted sources, the same ceiling the interactive draft uses. */
const MAX_SOURCES = 4;

export type GhlResult = {
  status: number;
  eventKey: string;
  fit: boolean;
  draftCreated: boolean;
  /** The message was already stored: this delivery added nothing. */
  duplicate: boolean;
  conversationId: string | null;
  detail: string;
};

export function authorizeGhl(headers: Headers, rawBody?: string): WebhookAuthResult {
  // Fail closed. A missing secret is a configuration fault, not an open door. The raw body is
  // passed through so a signature (HMAC over `${timestamp}.${rawBody}`) can be verified.
  return authorizeWebhook(headers, { rawBody });
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

/**
 * Receipt key for a delivery that failed. It is derived from the body, so a sender that retries the
 * same event updates one row instead of appending a new one per attempt (the previous key used
 * `Date.now()` and grew without bound).
 */
export function errorReceiptKey(rawBody: string): string {
  return `ghl:error-${createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 32)}`;
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
      duplicate: false,
      detail: "No message body was found. Nothing was drafted and nothing was sent.",
    });
    return {
      status: 202,
      eventKey,
      fit: false,
      draftCreated: false,
      duplicate: false,
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

  const duplicate = (inserted.rowCount ?? 0) === 0;
  let draftCreated = false;

  if (!duplicate) {
    // Same gate as the interactive draft: approved, in this project (or approved global), and never
    // a candidate source. rankKnowledgeRows() re-checks each row even though the SQL already filters.
    const ranked = await rankKnowledgeFromDatabase(client, parsed.body);
    const knowledge = ranked.eligible.slice(0, MAX_SOURCES).map((item) => ({
      chunkId: item.doc.id,
      orgId: MYCHEF_RETRIEVAL_SCOPE.workspaceId,
      sourceId: item.doc.id,
      title: item.doc.title,
      kind: item.kind,
      excerpt: item.doc.content.slice(0, 700),
      score: item.score,
    }));
    const draft = localStructuredDraft(parsed.body, knowledge, []);
    const why = retrievalNotice(ranked) ?? draft.why;
    const sourcePayload = {
      sources: draft.sourceRefs,
      confidence: draft.confidence,
      why,
      whyNot: draft.whyNot,
      escalate: draft.escalate,
      retrieval: {
        policyVersion: RETRIEVAL_POLICY_VERSION,
        workspaceId: MYCHEF_RETRIEVAL_SCOPE.workspaceId,
        projectId: MYCHEF_RETRIEVAL_SCOPE.projectId,
        path: "webhook",
        eligible: ranked.eligible.length,
        excluded: ranked.excluded,
      },
    };
    await client.query(
      `insert into mychef_inbox.drafts
         (workspace_id, conversation_id, body, author_id, kind, based_on_message_id, model, source_ids, prompt_version)
       values ($1, $2, $3, 'ghl-webhook', 'ai', $4, 'local', $5::jsonb, $6)`,
      [
        WORKSPACE,
        conversationId,
        draft.draftText,
        messageId,
        JSON.stringify(sourcePayload),
        JSON.stringify({ ...sourcePayload, channel: inbound.channel }),
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
          duplicate: false,
          conversationId,
          detail: "Inbound stored. Auto-pilot marked auto_sent_candidate. Sending is not connected.",
          excerpt: parsed.body.slice(0, 160),
        });
        return {
          status: 200,
          eventKey,
          fit: true,
          draftCreated: true,
          duplicate: false,
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
    duplicate,
    conversationId,
    detail: duplicate
      ? "This message was already stored. No second draft was created. Nothing was sent."
      : "Inbound stored and a local draft is pending. Nothing was sent.",
    excerpt: parsed.body.slice(0, 160),
  });

  return {
    status: 200,
    eventKey,
    fit: true,
    draftCreated,
    duplicate,
    conversationId,
    detail: duplicate ? "Already stored. No second draft was created." : "Stored. Nothing was sent.",
  };
}
