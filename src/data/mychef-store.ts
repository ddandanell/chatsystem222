/**
 * Neon mychef_inbox data access for the decision ledger and desk.
 * Purpose: conversations, drafts, feedback, knowledge, learning candidates.
 * Tables: contacts, conversations, messages, drafts, feedback, decision_records,
 *         knowledge, audit_log, integration_connections, webhook_receipts.
 * Do not auto-send. Channels stay adapters (GHL now; WhatsApp later).
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/cbls-architecture.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 */
import type { Pool, PoolClient } from "pg";
import { appPool } from "@/db/client";
import { recordAutoSendCandidateIfEnabled } from "@/lib/autopilot";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/crypto";
import {
  categoriesFromTags,
  parseFacts,
  tagsFromFacts,
  withTags,
  type ContactFacts,
} from "@/lib/contact-tags";
import { localStructuredDraft } from "@/lib/draft";
import { draftFreshness, threadBrief } from "@/lib/thread-memory";
import { runConversationAgent } from "@/lib/conversation-agent";
import {
  CONFIRMATION_REFUSAL,
  confirmationMatches,
  decisionTarget,
} from "@/lib/decision-confirmation";
import { groupForRow, type KnowledgeGroup, type KnowledgeGroupFilter } from "@/lib/knowledge-groups";
import {
  buildProposalContent,
  isKnowledgeGapReason,
  isLearnableReason,
  learningSnippet,
  parseProposalMeta,
  queueTypeForReason,
  statementForReason,
  type EvidenceDiff,
  type QueueType,
} from "@/lib/learning-queue";
import { PROVIDER_LABELS, PROVIDERS, type Provider } from "@/lib/providers";
import { rankKnowledgeFromDatabase } from "@/lib/knowledge-retrieval";
import { gateAuditAction, gateDraft } from "@/lib/draft-gate";
import {
  MYCHEF_RETRIEVAL_SCOPE,
  RETRIEVAL_POLICY_VERSION,
  kindForTitle,
  retrievalNotice,
} from "@/lib/retrieval-policy";
import type { HumanDecision, Outcome } from "@/lib/reason-codes";
import {
  REASON_FILTERS,
  STATE_FILTERS,
  bucketCaseSql,
  decisionCoversSql,
  emptyFilterCounts,
  isReasonFilter,
  lensWhereSql,
  queueWhereSql,
  visibleConversationSql,
  type DeskFilter,
  type DeskFilterCounts,
} from "@/lib/desk-filters";
import type { SourceRef } from "@/db/schema";

export const MYCHEF_WORKSPACE = "mychef";

type QueryResult<T> = T[];

type Db = Pool | PoolClient;

async function query<T>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  const result = await appPool.query(text, params);
  return result.rows as T[];
}

async function rows<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function dashboardCounts() {
  const rows = await query<{
    contacts: string;
    messages: string;
    knowledge: string;
    needs_reply: string;
    decisions: string;
    candidates: string;
  }>(
    `select
       (select count(*) from mychef_inbox.contacts where workspace_id = $1) as contacts,
       (select count(*) from mychef_inbox.messages where workspace_id = $1) as messages,
       (select count(*) from mychef_inbox.knowledge where workspace_id = $1 and source not in ('ledger-rule', 'learning-pass')) as knowledge,
       (select count(*) from mychef_inbox.conversations c
         where c.workspace_id = $1 and (${queueWhereSql("needs_reply")})) as needs_reply,
       (select count(*) from mychef_inbox.decision_records where workspace_id = $1) as decisions,
       (select count(*) from mychef_inbox.knowledge where workspace_id = $1 and source in ('ledger-rule', 'learning-pass') and status = 'pending') as candidates`,
    [MYCHEF_WORKSPACE],
  );
  const row = rows[0];
  return {
    contacts: Number(row?.contacts ?? 0),
    messages: Number(row?.messages ?? 0),
    knowledge: Number(row?.knowledge ?? 0),
    needsReply: Number(row?.needs_reply ?? 0),
    decisions: Number(row?.decisions ?? 0),
    candidates: Number(row?.candidates ?? 0),
  };
}

export async function dashboardReviewStats() {
  const rows = await query<{
    accepted: string;
    reviewed: string;
    escalations: string;
  }>(
    `select
       count(*) filter (
         where human_decision in ('approved', 'accepted')
           and coalesce(reason_code, '') <> 'auto_sent_candidate'
       )::text as accepted,
       count(*) filter (
         where coalesce(reason_code, '') <> 'auto_sent_candidate'
       )::text as reviewed,
       count(*) filter (where reason_code = 'needs_human')::text as escalations
     from mychef_inbox.decision_records
     where workspace_id = $1`,
    [MYCHEF_WORKSPACE],
  );
  const recent = await query<{
    conversation_id: string;
    name: string | null;
    created_at: Date;
  }>(
    `select d.conversation_id,
            ct.name,
            d.created_at
     from mychef_inbox.decision_records d
     left join mychef_inbox.conversations c
       on c.workspace_id = d.workspace_id and c.id = d.conversation_id
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where d.workspace_id = $1 and d.reason_code = 'needs_human'
     order by d.created_at desc
     limit 5`,
    [MYCHEF_WORKSPACE],
  );
  const row = rows[0];
  return {
    accepted: Number(row?.accepted ?? 0),
    reviewed: Number(row?.reviewed ?? 0),
    escalations: Number(row?.escalations ?? 0),
    recentEscalations: recent,
  };
}

const PAGE_SIZE = 25;

function pageOffset(page: number) {
  const safe = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return { page: safe, offset: (safe - 1) * PAGE_SIZE };
}

export async function listInbox(
  status: "pending_review" | "reviewed",
  page = 1,
  search = "",
) {
  const requested = pageOffset(page);
  const needle = search.trim().replace(/[%_]/g, "");
  if (status === "reviewed") {
    const totalRows = await query<{ n: string }>(
      `select count(*)::text as n
       from mychef_inbox.decision_records d
       left join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
       left join mychef_inbox.contacts ct
         on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
       where d.workspace_id = $1
         and ($2::text = '' or ct.name ilike '%' || $2 || '%')`,
      [MYCHEF_WORKSPACE, needle],
    );
    const total = Number(totalRows[0]?.n ?? 0);
    const safePage = Math.min(requested.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const offset = (safePage - 1) * PAGE_SIZE;
    const rows = await query<{
      id: string;
      name: string | null;
      inbound: string | null;
      draft: string | null;
      human_decision: string;
      reason_code: string;
      created_at: Date;
    }>(
      `select d.id::text as id,
              ct.name,
              left(m.body, 180) as inbound,
              left(f.original_draft, 180) as draft,
              d.human_decision,
              d.reason_code,
              d.created_at
       from mychef_inbox.decision_records d
       join mychef_inbox.feedback f on f.id = d.feedback_id
       left join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
       left join mychef_inbox.contacts ct
         on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
       left join lateral (
         select body from mychef_inbox.messages
         where workspace_id = d.workspace_id
           and conversation_id = d.conversation_id
           and direction = 'inbound'
         order by created_at desc
         limit 1
       ) m on true
       where d.workspace_id = $1
         and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       order by d.created_at desc
       limit $3 offset $4`,
      [MYCHEF_WORKSPACE, needle, PAGE_SIZE, offset],
    );
    return { rows, total, page: safePage, pageSize: PAGE_SIZE };
  }
  const totalRows = await query<{ n: string }>(
    `select count(*)::text as n
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where c.workspace_id = $1
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       and (${queueWhereSql("needs_reply")})`,
    [MYCHEF_WORKSPACE, needle],
  );
  const total = Number(totalRows[0]?.n ?? 0);
  const safePage = Math.min(requested.page, Math.max(1, Math.ceil(total / PAGE_SIZE) || 1));
  const offset = (safePage - 1) * PAGE_SIZE;
  const rows = await query<{
    id: string;
    name: string | null;
    inbound: string | null;
    draft: string | null;
    last_message_at: Date | null;
  }>(
    `select c.id,
            ct.name,
            left(m.body, 180) as inbound,
            left(dr.body, 180) as draft,
            c.last_message_at
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     left join lateral (
       select body from mychef_inbox.messages
       where workspace_id = c.workspace_id and conversation_id = c.id and direction = 'inbound'
       order by created_at desc limit 1
     ) m on true
     left join lateral (
       select body from mychef_inbox.drafts
       where workspace_id = c.workspace_id and conversation_id = c.id
       order by created_at desc limit 1
     ) dr on true
     where c.workspace_id = $1
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       and (${queueWhereSql("needs_reply")})
     order by c.last_message_at desc nulls last
     limit $3 offset $4`,
    [MYCHEF_WORKSPACE, needle, PAGE_SIZE, offset],
  );
  return { rows, total, page: safePage, pageSize: PAGE_SIZE };
}

export type DraftMeta = {
  sources: SourceRef[];
  confidence: number | null;
  why: string;
  whyNot: string;
  escalate: boolean;
  /** MC-169: how much of the thread this draft read. Null on drafts written before it was recorded. */
  thread: {
    messagesRead: number;
    messagesTotal: number;
    inbound: number;
    outbound: number;
  } | null;
};

function threadReportFrom(raw: unknown): DraftMeta["thread"] {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    messagesRead?: unknown;
    messagesTotal?: unknown;
    inbound?: unknown;
    outbound?: unknown;
  };
  if (typeof row.messagesRead !== "number" || !Number.isFinite(row.messagesRead)) return null;
  return {
    messagesRead: row.messagesRead,
    messagesTotal:
      typeof row.messagesTotal === "number" && Number.isFinite(row.messagesTotal)
        ? row.messagesTotal
        : row.messagesRead,
    inbound: typeof row.inbound === "number" ? row.inbound : 0,
    outbound: typeof row.outbound === "number" ? row.outbound : 0,
  };
}

function normalizeDraftMeta(raw: unknown): DraftMeta {
  if (Array.isArray(raw)) {
    return {
      sources: raw as SourceRef[],
      confidence: null,
      why: "",
      whyNot: "",
      escalate: false,
      thread: null,
    };
  }
  if (raw && typeof raw === "object") {
    const row = raw as {
      sources?: SourceRef[];
      confidence?: number;
      why?: string;
      whyNot?: string;
      escalate?: boolean;
      thread?: unknown;
    };
    return {
      sources: Array.isArray(row.sources) ? row.sources : [],
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      why: typeof row.why === "string" ? row.why : "",
      whyNot: typeof row.whyNot === "string" ? row.whyNot : "",
      escalate: Boolean(row.escalate),
      thread: threadReportFrom(row.thread),
    };
  }
  return { sources: [], confidence: null, why: "", whyNot: "", escalate: false, thread: null };
}

function draftMetaFromRow(sourceIds: unknown, promptVersion: string | null): DraftMeta {
  const fromIds = normalizeDraftMeta(sourceIds);
  const idsArePayload = sourceIds != null && typeof sourceIds === "object" && !Array.isArray(sourceIds);
  if (idsArePayload && (fromIds.why || fromIds.confidence != null || fromIds.sources.length > 0)) {
    return fromIds;
  }
  if (promptVersion) {
    try {
      const fromPrompt = normalizeDraftMeta(JSON.parse(promptVersion) as unknown);
      if (fromPrompt.why || fromPrompt.confidence != null || fromPrompt.sources.length > 0) {
        return {
          ...fromPrompt,
          sources: fromPrompt.sources.length > 0 ? fromPrompt.sources : fromIds.sources,
        };
      }
    } catch {
      return fromIds;
    }
  }
  return fromIds;
}

export async function getConversation(id: string) {
  const conversations = await query<{
    id: string;
    contact_id: string | null;
    contact_name: string | null;
    facts: { tags?: string[]; phone?: string; email?: string; address?: string } | null;
    project_id: string | null;
    status: string;
    channel: string | null;
    last_message_at: Date | null;
  }>(
    `select c.id, c.contact_id, ct.name as contact_name, ct.facts, c.project_id, c.status,
            c.channel, c.last_message_at
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where c.workspace_id = $1 and c.id = $2`,
    [MYCHEF_WORKSPACE, id],
  );
  const conversation = conversations[0];
  if (!conversation) return null;
  const facts = parseFacts(conversation.facts);
  const tags = tagsFromFacts(facts);
  const messages = await query<{
    id: string;
    direction: string;
    body: string;
    created_at: Date;
  }>(
    `select id, direction, body, created_at
     from mychef_inbox.messages
     where workspace_id = $1 and conversation_id = $2
     order by created_at desc
     limit 40`,
    [MYCHEF_WORKSPACE, id],
  );
  // MC-169: the newest 40 is what the thread pane shows, but a draft also has to know how the
  // conversation started. One of these imported threads holds 1,514 messages, so the opening is
  // fetched separately and the two are merged into the drafting context; the count is kept so the
  // desk can say "read 50 of 1,514" rather than implying it read everything.
  const totals = await query<{ total: string }>(
    `select count(*)::text as total
     from mychef_inbox.messages
     where workspace_id = $1 and conversation_id = $2`,
    [MYCHEF_WORKSPACE, id],
  );
  const messageCount = Number(totals[0]?.total ?? messages.length);
  const opening =
    messageCount > messages.length
      ? await query<{ id: string; direction: string; body: string; created_at: Date }>(
          `select id, direction, body, created_at
           from mychef_inbox.messages
           where workspace_id = $1 and conversation_id = $2
           order by created_at asc
           limit 10`,
          [MYCHEF_WORKSPACE, id],
        )
      : [];
  const drafting = new Map<string, (typeof messages)[number]>();
  for (const message of [...opening, ...[...messages].reverse()]) drafting.set(message.id, message);
  const draftingMessages = [...drafting.values()].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
  const drafts = await query<{
    id: string;
    body: string;
    model: string | null;
    created_at: Date;
    source_ids: unknown;
    prompt_version: string | null;
  }>(
    `select id::text as id, body, model, created_at, source_ids, prompt_version
     from mychef_inbox.drafts
     where workspace_id = $1 and conversation_id = $2
     order by created_at desc
     limit 1`,
    [MYCHEF_WORKSPACE, id],
  );
  // MC-182 / CS-001: `decided` is turn-bound. A decision covers the turn when no inbound message is
  // newer than it, so a guest follow-up re-opens the thread instead of being refused for ever.
  const decisions = await query<{ id: string; covers: boolean }>(
    `select d.id::text as id,
            case when ${decisionCoversSql("c")} then true else false end as covers
     from mychef_inbox.decision_records d
     join mychef_inbox.conversations c
       on c.workspace_id = d.workspace_id and c.id = d.conversation_id
     where d.workspace_id = $1 and d.conversation_id = $2
     order by d.created_at desc, d.id desc
     limit 1`,
    [MYCHEF_WORKSPACE, id],
  );
  const draftRow = drafts[0] ?? null;
  const meta = draftMetaFromRow(draftRow?.source_ids, draftRow?.prompt_version ?? null);
  return {
    ...conversation,
    facts,
    tags,
    categories: categoriesFromTags(tags),
    messages: messages.reverse(),
    /** What a draft is grounded on: the opening of the thread plus the newest messages. */
    thread: draftingMessages,
    /** Every message in the conversation, so the desk can say how much of it was read. */
    messageCount,
    draft: draftRow
      ? {
          ...draftRow,
          sources: meta.sources,
          confidence: meta.confidence,
          why: meta.why,
          whyNot: meta.whyNot,
          escalate: meta.escalate,
          thread: meta.thread,
        }
      : null,
    decided: decisions[0]?.covers === true,
  };
}

/**
 * Create the standing draft on open, or refresh one the thread has moved past (MC-168).
 *
 * The desk no longer waits for this before it paints: it renders whatever is stored and calls this
 * behind the page. So the decision here is only "is the stored draft still the answer to this
 * thread?", which draftFreshness() answers from timestamps: no draft, a draft missing its why, or a
 * draft older than the newest message all mean write one; anything else is left alone.
 */
export async function ensureDraftForConversation(
  conversationId: string,
  authorId: string,
  preloaded?: Awaited<ReturnType<typeof getConversation>>,
) {
  const conversation = preloaded ?? (await getConversation(conversationId));
  if (!conversation) return { ok: false as const, error: "That conversation is not in this workspace." };
  if (conversation.decided) {
    return { ok: false as const, error: "This conversation already has a recorded decision." };
  }
  const freshness = draftFreshness(
    conversation.thread ?? conversation.messages,
    conversation.draft,
    new Date(),
  );
  if (conversation.draft && !freshness.needsDraft) {
    return {
      ok: true as const,
      created: false as const,
      draft: conversation.draft,
      conversation,
    };
  }
  const drafted = await draftForConversation(conversationId, authorId);
  if (!drafted.ok) return drafted;
  const refreshed = await getConversation(conversationId);
  return {
    ok: true as const,
    created: true as const,
    draft: refreshed?.draft ?? null,
    conversation: refreshed ?? conversation,
    error: refreshed?.draft ? undefined : "Draft was written but could not be reloaded.",
  };
}

export async function getRecordedDecision(id: string) {
  const rows = await query<{
    id: string;
    conversation_id: string;
    human_decision: string;
    reason_code: string;
    rationale: string;
    why_not: string;
    rejected_alternative: string;
    created_at: Date;
    original_draft: string;
    edited_draft: string;
    inbound: string | null;
    contact_name: string | null;
  }>(
    `select d.id::text as id, d.conversation_id, d.human_decision, d.reason_code,
            d.rationale, d.why_not, d.rejected_alternative, d.created_at,
            f.original_draft, f.edited_draft,
            m.body as inbound,
            ct.name as contact_name
     from mychef_inbox.decision_records d
     join mychef_inbox.feedback f on f.id = d.feedback_id
     left join mychef_inbox.conversations c
       on c.workspace_id = d.workspace_id and c.id = d.conversation_id
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     left join lateral (
       select body from mychef_inbox.messages
       where workspace_id = d.workspace_id and conversation_id = d.conversation_id
         and direction = 'inbound'
       order by created_at desc limit 1
     ) m on true
     where d.workspace_id = $1 and d.id = $2::uuid`,
    [MYCHEF_WORKSPACE, id],
  );
  const decision = rows[0];
  if (!decision) return null;
  const outcome = await query<{ action: string }>(
    `select action from mychef_inbox.audit_log
     where workspace_id = $1 and record_id = $2 and action like 'outcome:%'
     order by created_at desc limit 1`,
    [MYCHEF_WORKSPACE, id],
  );
  return {
    ...decision,
    outcome: outcome[0]?.action?.slice("outcome:".length) ?? null,
  };
}

/**
 * MC-182: the queue lists conversations, so the desk has to be able to open the ledger row for a
 * conversation id. Before this, only a decision id resolved, which is why the new `decided` filter
 * would have shown a fresh draft and an Approve button for a conversation that already has a
 * decision — the write path refuses that, but a refusal is not a receipt.
 */
export async function getRecordedDecisionForConversation(conversationId: string) {
  // The receipt is turn-bound, same rule as the queue's `decided` chip. A guest follow-up after
  // the newest decision must open the composer, not the previous verdict.
  const rows = await query<{ id: string }>(
    `select d.id::text as id
     from mychef_inbox.decision_records d
     join mychef_inbox.conversations c
       on c.workspace_id = d.workspace_id and c.id = d.conversation_id
     where d.workspace_id = $1 and d.conversation_id = $2
       and ${decisionCoversSql("c")}
     order by d.created_at desc, d.id desc
     limit 1`,
    [MYCHEF_WORKSPACE, conversationId],
  );
  const id = rows[0]?.id;
  if (!id) return null;
  return getRecordedDecision(id);
}

/**
 * Authoritative knowledge only: approved, in this project (or approved global), never a candidate
 * source. The SQL gate is the first line; rankKnowledgeRows() re-checks every row so a future
 * query change cannot silently widen the set. Exclusion counts come from a grouped metadata
 * query, so a reviewer is told what was withheld without loading pending content.
 */
export async function rankKnowledge(inbound: string, tagHint = "") {
  // One implementation, shared with the GHL webhook (see src/lib/knowledge-retrieval.ts).
  return rankKnowledgeFromDatabase(appPool, inbound, tagHint);
}

type DraftHint = string | null | { tagHint?: string };

export async function draftForConversation(
  conversationId: string,
  authorId: string,
  hint?: DraftHint,
) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { ok: false as const, error: "That conversation is not in this workspace." };
  if (conversation.decided) {
    return { ok: false as const, error: "This conversation already has a recorded decision." };
  }
  const threadMessages = conversation.thread ?? conversation.messages;
  const brief = threadBrief(threadMessages);
  const inbound =
    [...conversation.messages].reverse().find((message) => message.direction === "inbound")
      ?.body ?? "";
  if (!inbound.trim()) return { ok: false as const, error: "This conversation has no inbound message." };
  const tagHint =
    typeof hint === "string"
      ? hint
      : hint && typeof hint === "object" && hint.tagHint
        ? hint.tagHint
        : conversation.tags.join(" ");
  const ranked = await rankKnowledge(inbound, tagHint);
  const knowledge = ranked.eligible.slice(0, 4).map((item) => ({
      chunkId: item.doc.id,
      orgId: MYCHEF_WORKSPACE,
      sourceId: item.doc.id,
      title: item.doc.title,
      kind: item.kind,
      excerpt: item.doc.content.slice(0, 700),
      score: item.score,
    }));
  // MC-169: the reply is grounded on the whole thread (first message to last), not on the newest
  // inbound alone, so it cannot re-ask a detail the guest gave three messages ago. Retrieval stays
  // keyed on the message being answered; the drafting context is the conversation.
  const draft = localStructuredDraft(inbound, knowledge, [], threadMessages);
  const notice = retrievalNotice(ranked);
  const why = notice ?? draft.why;
  const messageId = [...conversation.messages]
    .reverse()
    .find((message) => message.direction === "inbound")?.id;
  const sourcePayload = {
    sources: draft.sourceRefs,
    confidence: draft.confidence,
    why,
    whyNot: draft.whyNot,
    escalate: draft.escalate,
    thread: {
      messagesRead: brief.messagesRead,
      messagesTotal: conversation.messageCount ?? brief.messagesRead,
      inbound: brief.inbound,
      outbound: brief.outbound,
      firstAt: brief.firstAt,
      lastAt: brief.lastAt,
    },
    retrieval: {
      policyVersion: RETRIEVAL_POLICY_VERSION,
      workspaceId: MYCHEF_RETRIEVAL_SCOPE.workspaceId,
      projectId: MYCHEF_RETRIEVAL_SCOPE.projectId,
      eligible: ranked.eligible.length,
      excluded: ranked.excluded,
    },
  };
  await query(
    `insert into mychef_inbox.drafts
       (workspace_id, conversation_id, body, author_id, kind, based_on_message_id, model, source_ids, prompt_version)
     values ($1, $2, $3, $4, 'ai', $5, 'local', $6::jsonb, $7)`,
    [
      MYCHEF_WORKSPACE,
      conversationId,
      draft.draftText,
      authorId,
      messageId ?? null,
      JSON.stringify(sourcePayload),
      JSON.stringify({
        ...sourcePayload,
        tag: tagHint || null,
      }),
    ],
  );
  const auto = await recordAutoSendCandidateIfEnabled(appPool, {
    conversationId,
    projectId: conversation.project_id || MYCHEF_WORKSPACE,
    authorId,
    draftText: draft.draftText,
    confidence: draft.confidence,
    escalate: draft.escalate,
    sourceRefs: draft.sourceRefs,
  }).catch(() => ({ fired: false }));
  return { ok: true as const, draft, autoSendCandidate: auto.fired };
}

/**
 * The conversation agent. One focused call, always a draft. Do not auto-send.
 *
 * Purpose: an operator presses Agent at the top of a conversation; this reads only that
 * conversation, the approved knowledge for its project, and the operator's note, then writes the
 * reply to mychef_inbox.drafts exactly like a local draft so the same review and approval gate
 * applies. If no key answers, the local reply is written and the provenance says so.
 * Specs: documentation/agent-spec.md, src/lib/conversation-agent.ts.
 */
export async function agentDraftForConversation(
  conversationId: string,
  authorId: string,
  instruction?: string,
) {
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return { ok: false as const, error: "That conversation is not in this workspace." };
  }
  if (conversation.decided) {
    return { ok: false as const, error: "This conversation already has a recorded decision." };
  }
  const inboundMessage = [...conversation.messages]
    .reverse()
    .find((message) => message.direction === "inbound");
  const inbound = inboundMessage?.body ?? "";
  if (!inbound.trim()) {
    return { ok: false as const, error: "This conversation has no inbound message to answer." };
  }
  const tagHint = conversation.tags.join(" ");
  const ranked = await rankKnowledge(inbound, tagHint);
  const agent = await runConversationAgent(
    {
      workspaceId: MYCHEF_WORKSPACE,
      projectId: conversation.project_id || MYCHEF_RETRIEVAL_SCOPE.projectId,
      conversationId,
      contactName: conversation.contact_name,
      channel: conversation.channel,
      status: conversation.status,
      tags: conversation.tags,
      contactFacts: conversation.facts ?? {},
      messages: conversation.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        created_at: message.created_at,
        conversation_id: conversationId,
      })),
      ranked: ranked.eligible,
      instruction,
    },
    { orgId: MYCHEF_WORKSPACE },
  );

  const provenance = {
    sources: agent.sourceRefs,
    confidence: agent.confidence,
    why: agent.why,
    whyNot: agent.whyNot,
    escalate: agent.escalate,
    thread: {
      ...agent.thread,
      messagesTotal: conversation.messageCount ?? agent.thread.messagesRead,
    },
    agent: {
      promptVersion: agent.promptVersion,
      provider: agent.provider,
      model: agent.model,
      fellBack: agent.fellBack,
      notice: agent.notice,
      latencyMs: agent.latencyMs,
      instruction: instruction?.trim().slice(0, 600) || null,
    },
    retrieval: {
      policyVersion: RETRIEVAL_POLICY_VERSION,
      workspaceId: MYCHEF_RETRIEVAL_SCOPE.workspaceId,
      projectId: MYCHEF_RETRIEVAL_SCOPE.projectId,
      eligible: ranked.eligible.length,
      excluded: ranked.excluded,
    },
  };

  await query(
    `insert into mychef_inbox.drafts
       (workspace_id, conversation_id, body, author_id, kind, based_on_message_id, model, source_ids, prompt_version)
     values ($1, $2, $3, $4, 'ai', $5, $6, $7::jsonb, $8)`,
    [
      MYCHEF_WORKSPACE,
      conversationId,
      agent.draftText,
      authorId,
      inboundMessage?.id ?? null,
      agent.fellBack ? "local" : `${agent.provider}:${agent.model}`,
      JSON.stringify(provenance),
      JSON.stringify(provenance),
    ],
  );

  return {
    ok: true as const,
    agent,
    conversation: (await getConversation(conversationId)) ?? conversation,
  };
}

/**
 * CS-020: renegotiate. The operator writes what the draft got wrong; that sentence goes into the
 * provider call as the instruction (agentDraftForConversation stores it in the draft provenance), and
 * the correction itself becomes a pending situational case so the learning queue holds it. Nothing is
 * published, approved or sent by this path — a person still has to approve the rewritten draft and a
 * person still has to approve the case.
 */
export async function renegotiateDraft(
  conversationId: string,
  authorId: string,
  correction: string,
) {
  const text = correction.trim().slice(0, 600);
  if (!text) {
    return { ok: false as const, error: "Write what should change before renegotiating." };
  }
  const before = await getConversation(conversationId);
  if (!before) return { ok: false as const, error: "That conversation is not in this workspace." };
  if (before.decided) {
    return { ok: false as const, error: "This conversation already has a recorded decision." };
  }
  if (!before.draft) {
    return { ok: false as const, error: "There is no draft to correct yet. Write one first." };
  }
  const rewritten = await agentDraftForConversation(conversationId, authorId, text);
  if (!rewritten.ok) return rewritten;

  const content = buildProposalContent({
    evidence: 1,
    group: "procedure_gap",
    reason: "renegotiate",
    queueType: "Suggested",
    snippet: text,
    diffs: [
      {
        decisionId: conversationId,
        ai: before.draft.body.slice(0, 800),
        human: "",
        why: text,
      },
    ],
  });
  const title = `Correction · ${before.contact_name ?? conversationId}`;
  const base = `correction:${conversationId}`;
  const existing = await query<{ id: string; status: string }>(
    `select id, status from mychef_inbox.knowledge where workspace_id = $1 and id like $2`,
    [MYCHEF_WORKSPACE, `${base}%`],
  );
  const live = existing.find((row) => row.status === "pending");
  const id = live?.id ?? (existing.length === 0 ? base : `${base}:${Date.now()}`);
  if (live) {
    await query(
      `update mychef_inbox.knowledge
       set title = $3, content = $4, category = 'procedure_gap', updated_at = now(), version = version + 1
       where workspace_id = $1 and id = $2 and status = 'pending'`,
      [MYCHEF_WORKSPACE, id, title, content],
    );
  } else {
    await query(
      `insert into mychef_inbox.knowledge
         (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
       values ($1, $2, $3, $4, 'procedure_gap', 'pending', 'business', 'situational', 1, $5, 'general', now(), now())`,
      [MYCHEF_WORKSPACE, id, title, content, before.project_id || "mychef"],
    );
  }
  await query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, 'renegotiate', $3)`,
    [MYCHEF_WORKSPACE, authorId, conversationId],
  );
  return {
    ok: true as const,
    instruction: text,
    caseId: id,
    conversation: rewritten.conversation,
  };
}

function neonDecision(decision: HumanDecision): "approved" | "edited" | "rejected" {
  if (decision === "accepted") return "approved";
  if (decision === "edited") return "edited";
  return "rejected";
}

export async function reviewConversation(
  conversationId: string,
  authorId: string,
  input: {
    humanDecision: HumanDecision;
    reasonCode: string;
    rationale: string;
    whyNot: string;
    finalText: string;
    remember?: boolean;
    tags?: string[];
    /** B3: the person the operator confirmed they are deciding. Checked before anything is written. */
    confirmName?: string;
    /** The reviewer pressed the below-bar confirmation for this exact text. */
    gateAck?: boolean;
  },
) {
  const conversation = await getConversation(conversationId);
  if (!conversation) return { ok: false as const, error: "That conversation is not in this workspace." };
  if (conversation.decided) return { ok: false as const, error: "This conversation was already reviewed." };
  // B3: a decision is append-only — no undo, no delete. Naming the object is the only guard against
  // recording a verdict for the wrong person from a stale tab or a shared screen.
  const target = decisionTarget({
    contactName: conversation.contact_name,
    conversationId: conversation.id,
  });
  if (!confirmationMatches(input.confirmName, target)) {
    return { ok: false as const, error: CONFIRMATION_REFUSAL };
  }
  if (!conversation.draft) return { ok: false as const, error: "Draft a reply before recording a decision." };
  const human = neonDecision(input.humanDecision);
  const finalText = input.finalText.trim() || conversation.draft.body;

  // CS-018: the gate is computed here, on the server, from the text actually being recorded and the
  // approval state of the knowledge it cites. The desk renders the same function, but a stale or
  // edited client value can never decide this: below bar without the explicit confirmation is
  // refused before a row is written. Escalation approves nothing, so it is not gated.
  const citedIds = (conversation.draft.sources ?? []).map((source) => source.id);
  const citedStatus = citedIds.length
    ? await query<{ id: string; status: string }>(
        `select id, status from mychef_inbox.knowledge
         where workspace_id = $1 and id = any($2::text[])`,
        [MYCHEF_WORKSPACE, citedIds],
      )
    : [];
  const statusById = new Map(citedStatus.map((row) => [row.id, row.status]));
  const gate = gateDraft({
    draftText: finalText,
    thread: conversation.messages,
    sources: citedIds.map((id) => ({ id, status: statusById.get(id) ?? null })),
  });
  if (gate.belowBar && input.humanDecision !== "escalated" && !input.gateAck) {
    const blocked = gate.checks.find((check) => !check.pass);
    return {
      ok: false as const,
      error: `Below the quality bar (${gate.score}/${gate.max}): ${(blocked?.why ?? "the gate did not pass").replace(/\.$/, "")}. Confirm to record it anyway.`,
      gate,
    };
  }

  const client = await appPool.connect();
  try {
    await client.query("begin");
    // The row lock comes before every write, and it is on the conversation row: two operators
    // pressing Approve at the same instant cannot both pass the turn check below.
    const locked = await client.query<{ covered: boolean }>(
      `select ${decisionCoversSql("c")} as covered
       from mychef_inbox.conversations c
       where c.workspace_id = $1 and c.id = $2
       for update`,
      [MYCHEF_WORKSPACE, conversationId],
    );
    if (locked.rowCount === 0) {
      await client.query("rollback");
      return { ok: false as const, error: "That conversation is not in this workspace." };
    }
    if (locked.rows[0]?.covered) {
      await client.query("rollback");
      return { ok: false as const, error: "This conversation was already reviewed." };
    }
    const feedback = await client.query<{ id: string }>(
      `insert into mychef_inbox.feedback
         (workspace_id, conversation_id, scope, note, original_draft, edited_draft, author_id)
       values ($1, $2, 'conversation', $3, $4, $5, $6)
       returning id::text as id`,
      [
        MYCHEF_WORKSPACE,
        conversationId,
        input.rationale,
        conversation.draft.body,
        finalText,
        authorId,
      ],
    );
    const feedbackId = feedback.rows[0]?.id;
    if (!feedbackId) throw new Error("feedback was not stored");
    const sourceRefs = conversation.draft.sources ?? [];
    const recorded = await client.query<{ id: string }>(
      `insert into mychef_inbox.decision_records
         (workspace_id, conversation_id, project_id, feedback_id, reason_code, rationale, why_not,
          rejected_alternative, human_decision, source_refs, author_id)
       values ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $11::jsonb, $10)
       returning id::text as id`,
      [
        MYCHEF_WORKSPACE,
        conversationId,
        conversation.project_id || "mychef",
        feedbackId,
        input.reasonCode,
        input.rationale,
        input.whyNot,
        input.humanDecision === "escalated" ? "escalated" : "",
        human,
        authorId,
        JSON.stringify(sourceRefs),
      ],
    );
    const decisionId = recorded.rows[0]?.id;
    if (!decisionId) throw new Error("decision was not stored");
    await client.query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'feedback', $3)`,
      [MYCHEF_WORKSPACE, authorId, decisionId],
    );
    if (gate.belowBar && input.humanDecision !== "escalated") {
      await client.query(
        `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
         values ($1, $2, $3, $4)`,
        [MYCHEF_WORKSPACE, authorId, gateAuditAction(gate), decisionId],
      );
    }
    // CS-022: a rejection is a correction too. Before this, only an edit with Remember on created a
    // case, so "wrong price / invented detail" was recorded in the ledger and never reached the
    // learning queue. A rejection needs a written reason to be learnable; an edit needs changed text.
    const learnsFromDecision =
      input.humanDecision === "edited" || input.humanDecision === "rejected";
    const decisionSignal = input.rationale.trim() || input.whyNot.trim();
    if (
      input.remember &&
      learnsFromDecision &&
      decisionId &&
      decisionSignal &&
      (input.humanDecision === "rejected" || finalText.trim() !== conversation.draft.body.trim())
    ) {
      const tag = (input.tags ?? conversation.tags)[0] ?? "general";
      const snippetId = `situational:${decisionId}`;
      const content = [
        `context_tag: ${tag}`,
        `reason: ${input.reasonCode}`,
        `decision: ${input.humanDecision}`,
        `source_decision_ids: ${decisionId}`,
        "",
        "## Proposed snippet",
        decisionSignal,
        "",
        "## AI draft",
        conversation.draft.body,
        input.humanDecision === "rejected" ? "## Rejected as drafted" : "## Human final",
        input.humanDecision === "rejected" ? finalText || "(rejected, no replacement written)" : finalText,
        "",
        "## Why not",
        input.whyNot.trim() || "—",
      ].join("\n");
      await client.query(
        `insert into mychef_inbox.knowledge
           (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'pending', 'business', 'situational', 1, 'mychef', 'general', now(), now())
         on conflict (workspace_id, id) do update
           set content = excluded.content,
               title = excluded.title,
               updated_at = now()
           where mychef_inbox.knowledge.status = 'pending'`,
        [
          MYCHEF_WORKSPACE,
          snippetId,
          `Situational case · ${tag} · ${input.reasonCode}`,
          content,
          tag.slice(0, 80) || "situational",
        ],
      );
    }
    // CS round 3: the verdict is what moves the thread out of the queue. `ghl-inbound.ts` puts it
    // back to 'needs_reply' when the guest writes again, so the status column and the ledger agree
    // and the badge counts the column instead of subtracting decision rows.
    await client.query(
      `update mychef_inbox.conversations
          set status = 'waiting'
        where workspace_id = $1 and id = $2 and status = 'needs_reply'`,
      [MYCHEF_WORKSPACE, conversationId],
    );
    await client.query("commit");
    return { ok: true as const, id: decisionId };
  } catch (error) {
    await client.query("rollback");
    const message = error instanceof Error ? error.message : "Review was not saved.";
    return { ok: false as const, error: message.split("\n")[0] };
  } finally {
    client.release();
  }
}

export type { DeskFilter } from "@/lib/desk-filters";

export type DeskQueueItem = {
  id: string;
  kind: "conversation" | "decision";
  name: string | null;
  snippet: string;
  when: Date | null;
  tags: string[];
  categories: ReturnType<typeof categoriesFromTags>;
  confidence: number | null;
  unread: boolean;
  channel: string | null;
  filterBucket: DeskFilter;
};

function confidenceFromSourceIds(raw: unknown): number | null {
  return normalizeDraftMeta(raw).confidence;
}

/**
 * MC-182. Rows and counts both take their predicate from `@/lib/desk-filters`, so the number on a
 * chip is the number of rows that chip opens — one definition, two callers. The previous version
 * collapsed `all` and `needs_review` into one predicate, which left 672 of 791 conversations
 * reachable by no filter at all.
 */
export async function listDeskQueue(
  filter: DeskFilter = "needs_reply",
  page = 1,
  search = "",
): Promise<{ rows: DeskQueueItem[]; total: number; page: number; pageSize: number }> {
  const requested = pageOffset(page);
  const needle = search.trim().replace(/[%_]/g, "");

  if (isReasonFilter(filter)) {
    const totalRows = await query<{ n: string }>(
      `select count(*)::text as n
       from mychef_inbox.decision_records d
       left join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
       left join mychef_inbox.contacts ct
         on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
       where d.workspace_id = $1
         and (${lensWhereSql(filter)})
         and ($2::text = '' or ct.name ilike '%' || $2 || '%')`,
      [MYCHEF_WORKSPACE, needle],
    );
    const total = Number(totalRows[0]?.n ?? 0);
    const safePage = Math.min(requested.page, Math.max(1, Math.ceil(total / PAGE_SIZE) || 1));
    const offset = (safePage - 1) * PAGE_SIZE;
    const rows = await query<{
      id: string;
      name: string | null;
      inbound: string | null;
      created_at: Date;
      facts: unknown;
      channel: string | null;
      reason_code: string;
    }>(
      `select d.id::text as id, ct.name, left(m.body, 160) as inbound, d.created_at,
              ct.facts, c.channel, d.reason_code
       from mychef_inbox.decision_records d
       left join mychef_inbox.conversations c
         on c.workspace_id = d.workspace_id and c.id = d.conversation_id
       left join mychef_inbox.contacts ct
         on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
       left join lateral (
         select body from mychef_inbox.messages
         where workspace_id = d.workspace_id and conversation_id = d.conversation_id
           and direction = 'inbound'
         order by created_at desc limit 1
       ) m on true
       where d.workspace_id = $1
         and (${lensWhereSql(filter)})
         and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       order by d.created_at desc
       limit $3 offset $4`,
      [MYCHEF_WORKSPACE, needle, PAGE_SIZE, offset],
    );
    return {
      rows: rows.map((row) => {
        const tags = tagsFromFacts(parseFacts(row.facts));
        return {
          id: row.id,
          kind: "decision" as const,
          name: row.name,
          snippet: row.inbound ?? "",
          when: row.created_at,
          tags,
          categories: categoriesFromTags(tags),
          confidence: null,
          unread: false,
          channel: row.channel,
          filterBucket: filter,
        };
      }),
      total,
      page: safePage,
      pageSize: PAGE_SIZE,
    };
  }

  const bucket = `(${bucketCaseSql()})`;

  const totalRows = await query<{ n: string }>(
    `select count(*)::text as n
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where c.workspace_id = $1
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       and (${queueWhereSql(filter)})`,
    [MYCHEF_WORKSPACE, needle],
  );
  const total = Number(totalRows[0]?.n ?? 0);
  const safePage = Math.min(requested.page, Math.max(1, Math.ceil(total / PAGE_SIZE) || 1));
  const offset = (safePage - 1) * PAGE_SIZE;
  const rows = await query<{
    id: string;
    name: string | null;
    inbound: string | null;
    last_message_at: Date | null;
    facts: unknown;
    channel: string | null;
    source_ids: unknown;
    bucket: string;
  }>(
    `select c.id, ct.name, left(m.body, 160) as inbound, c.last_message_at,
            ct.facts, c.channel, dr.source_ids, ${bucket} as bucket
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     left join lateral (
       select body from mychef_inbox.messages
       where workspace_id = c.workspace_id and conversation_id = c.id and direction = 'inbound'
       order by created_at desc limit 1
     ) m on true
     left join lateral (
       select source_ids from mychef_inbox.drafts
       where workspace_id = c.workspace_id and conversation_id = c.id
       order by created_at desc limit 1
     ) dr on true
     where c.workspace_id = $1
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')
       and (${queueWhereSql(filter)})
     order by c.last_message_at desc nulls last
     limit $3 offset $4`,
    [MYCHEF_WORKSPACE, needle, PAGE_SIZE, offset],
  );
  return {
    rows: rows.map((row) => {
      const tags = tagsFromFacts(parseFacts(row.facts));
      const confidence = confidenceFromSourceIds(row.source_ids);
      const bucketId = row.bucket as DeskFilter;
      return {
        id: row.id,
        kind: "conversation" as const,
        name: row.name,
        snippet: row.inbound ?? "",
        when: row.last_message_at,
        tags,
        categories: categoriesFromTags(tags),
        confidence,
        unread: bucketId === "needs_reply",
        channel: row.channel,
        filterBucket: bucketId,
      };
    }),
    total,
    page: safePage,
    pageSize: PAGE_SIZE,
  };
}

/**
 * MC-182: the number on every chip. Conversation states come from the same bucket expression the
 * list uses; the two decision lenses from the same predicates. One round trip each, never a query
 * per chip.
 */
export async function deskFilterCounts(search = ""): Promise<DeskFilterCounts> {
  const needle = search.trim().replace(/[%_]/g, "");
  const bucket = `(${bucketCaseSql()})`;
  const counts = emptyFilterCounts();

  const conversationRows = await query<Record<string, string>>(
    `select count(*)::text as total,
            count(*) filter (where ${bucket} = 'needs_reply')::text as needs_reply,
            count(*) filter (where ${bucket} = 'waiting')::text as waiting,
            count(*) filter (where ${bucket} = 'decided')::text as decided,
            count(*) filter (where ${bucket} = 'closed')::text as closed
     from mychef_inbox.conversations c
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where c.workspace_id = $1
       and (${visibleConversationSql("c")})
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')`,
    [MYCHEF_WORKSPACE, needle],
  );
  const conversationRow = conversationRows[0] ?? {};
  for (const id of ["all", ...STATE_FILTERS] as DeskFilter[]) {
    const raw = id === "all" ? conversationRow.total : conversationRow[id];
    counts[id] = Number(raw ?? 0);
  }

  const decisionRows = await query<Record<string, string>>(
    `select count(*) filter (where ${lensWhereSql("escalated")})::text as escalated,
            count(*) filter (where ${lensWhereSql("auto_sent")})::text as auto_sent
     from mychef_inbox.decision_records d
     left join mychef_inbox.conversations c
       on c.workspace_id = d.workspace_id and c.id = d.conversation_id
     left join mychef_inbox.contacts ct
       on ct.workspace_id = c.workspace_id and ct.id = c.contact_id
     where d.workspace_id = $1
       and ($2::text = '' or ct.name ilike '%' || $2 || '%')`,
    [MYCHEF_WORKSPACE, needle],
  );
  const decisionRow = decisionRows[0] ?? {};
  for (const id of REASON_FILTERS) {
    counts[id] = Number(decisionRow[id] ?? 0);
  }
  return counts;
}

export async function updateContactTags(conversationId: string, tags: string[]) {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contact_id) {
    return { ok: false as const, error: "That conversation has no contact." };
  }
  const next = withTags(conversation.facts as ContactFacts, tags);
  await query(
    `update mychef_inbox.contacts
     set facts = $3::jsonb
     where workspace_id = $1 and id = $2`,
    [MYCHEF_WORKSPACE, conversation.contact_id, JSON.stringify(next)],
  );
  return { ok: true as const, tags: tagsFromFacts(next) };
}

export type LearningCandidate = {
  id: string;
  title: string;
  content: string;
  status: string;
  category: string;
  source: string;
  updated_at: Date;
  snippet: string;
  aiDraft: string;
  humanFinal: string;
  group: string;
};

function parseLearningCard(content: string, title: string): Pick<
  LearningCandidate,
  "snippet" | "aiDraft" | "humanFinal" | "group"
> {
  const group = content.match(/^group:\s*(.+)$/m)?.[1]?.trim()
    || content.match(/^context_tag:\s*(.+)$/m)?.[1]?.trim()
    || "suggested";
  const snippet =
    content.match(/## Proposed snippet\n([\s\S]*?)(?=\n## |\n*$)/)?.[1]?.trim()
    || title;
  const aiDraft = content.match(/## AI draft\n([\s\S]*?)(?=\n## |\n*$)/)?.[1]?.trim() || "";
  const humanFinal = content.match(/## Human final\n([\s\S]*?)(?=\n## |\n*$)/)?.[1]?.trim() || "";
  return { snippet, aiDraft, humanFinal, group };
}

export async function listLearningCandidates(): Promise<LearningCandidate[]> {
  const rows = await query<{
    id: string;
    title: string;
    content: string;
    status: string;
    category: string;
    source: string;
    updated_at: Date;
  }>(
    `select id, title, content, status, category, source, updated_at
     from mychef_inbox.knowledge
     where workspace_id = $1
       and source in ('ledger-rule', 'situational', 'learning-pass')
       and status = 'pending'
     order by updated_at desc`,
    [MYCHEF_WORKSPACE],
  );
  return rows.map((row) => ({
    ...row,
    ...parseLearningCard(row.content, row.title),
  }));
}

export async function recordOutcome(decisionId: string, actorId: string, outcome: Outcome) {
  await query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, $3, $4)`,
    [MYCHEF_WORKSPACE, actorId, `outcome:${outcome}`, decisionId],
  );
}

export type StoredKnowledge = {
  id: string;
  title: string;
  content: string;
  project_id: string;
  /** approved | pending | retired. Legacy drafts can still cite a pending row. */
  status: string;
  kind: "position" | "playbook";
  /** Seven-group filing value, or "unclassified" when nothing matches. Never silently defaulted. */
  group: KnowledgeGroupFilter;
};

export async function listStoredKnowledge(): Promise<StoredKnowledge[]> {
  const rows = await query<{
    id: string;
    title: string;
    content: string;
    project_id: string;
    scope: string | null;
    status: string;
  }>(
    `select id, title, content, project_id, scope, status
     from mychef_inbox.knowledge
     where workspace_id = $1 and source not in ('ledger-rule', 'learning-pass', 'menu')
     order by title`,
    [MYCHEF_WORKSPACE],
  );
  return rows.map((row) => ({
    ...row,
    kind: kindForTitle(row.title),
    group: groupForRow({ title: row.title, scope: row.scope, project_id: row.project_id }),
  }));
}

export async function getStoredKnowledge(id: string) {
  const rows = await listStoredKnowledge();
  return rows.find((row) => row.id === id) ?? null;
}

export async function listKnowledgeDrafts() {
  const rows = await query<{
    id: string;
    title: string;
    status: string;
    project_id: string;
    source: string;
    scope: string | null;
  }>(
    `select id, title, status, project_id, source, scope
     from mychef_inbox.knowledge
     where workspace_id = $1 and source not in ('ledger-rule', 'learning-pass', 'menu')
     order by status, title`,
    [MYCHEF_WORKSPACE],
  );
  return rows.map((row) => ({
    ...row,
    group: groupForRow({ title: row.title, scope: row.scope, project_id: row.project_id }),
  }));
}

export async function setKnowledgeStatus(
  id: string,
  status: "pending" | "approved" | "retired",
  actorId: string,
) {
  const updated = await query<{ id: string }>(
    `update mychef_inbox.knowledge
     set status = $3, updated_at = now(), version = version + 1
     where workspace_id = $1 and id = $2 and source not in ('ledger-rule', 'learning-pass', 'situational', 'menu')
     returning id`,
    [MYCHEF_WORKSPACE, id, status],
  );
  if (updated.length === 0) return { ok: false as const, error: "That knowledge row is not in this workspace." };
  await query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, $3, $4)`,
    [MYCHEF_WORKSPACE, actorId, `knowledge:${status}`, id],
  );
  return { ok: true as const };
}

export async function addPosition(input: {
  title: string;
  body: string;
  group: KnowledgeGroup;
}) {
  const id = `position-${crypto.randomUUID()}`;
  await query(
    `insert into mychef_inbox.knowledge
       (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'pending', 'business', 'ledger-position', 1, 'mychef', 'general', now(), now())`,
    [MYCHEF_WORKSPACE, id, input.title.trim(), input.body.trim(), input.group],
  );
  return id;
}

type RuleRow = {
  id: string;
  title: string;
  content: string;
  status: string;
  category: string;
  source: string;
  updated_at: Date;
};

export async function listRuleCandidates(): Promise<RuleRow[]> {
  return query<RuleRow>(
    `select id, title, content, status, category, source, updated_at
     from mychef_inbox.knowledge
     where workspace_id = $1 and source in ('ledger-rule', 'learning-pass', 'situational')
     order by updated_at desc`,
    [MYCHEF_WORKSPACE],
  );
}

export type LearningQueueCard = {
  id: string;
  title: string;
  content: string;
  status: string;
  source: string;
  category: string;
  updatedAt: Date;
  queueType: QueueType;
  evidence: string;
  reason: string;
  snippet: string;
  diffs: { decisionId: string; ai: string; human: string; why: string }[];
};

export async function listLearningQueue(
  filter: QueueType | "all" = "all",
): Promise<LearningQueueCard[]> {
  const rows = await query<{
    id: string;
    title: string;
    content: string;
    status: string;
    source: string;
    category: string;
    updated_at: Date;
  }>(
    `select id, title, content, status, source, category, updated_at
     from mychef_inbox.knowledge
     where workspace_id = $1
       and source in ('ledger-rule', 'learning-pass', 'situational')
     order by
       case status when 'pending' then 0 when 'approved' then 1 else 2 end,
       updated_at desc`,
    [MYCHEF_WORKSPACE],
  );
  return rows
    .map((row) => {
      const meta = parseProposalMeta(row.content);
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        status: row.status,
        source: row.source,
        category: row.category,
        updatedAt: row.updated_at,
        queueType: meta.queueType,
        evidence: meta.evidence,
        reason: meta.reason,
        snippet: meta.snippet || row.title,
        diffs: meta.diffs,
      };
    })
    .filter((card) => filter === "all" || card.queueType === filter);
}

export async function runMychefLearning(actorId: string) {
  const grouped = await query<{ reason_code: string; n: string }>(
    `select reason_code, count(*)::text as n
     from mychef_inbox.decision_records
     where workspace_id = $1
     group by reason_code`,
    [MYCHEF_WORKSPACE],
  );
  let created = 0;
  let goodAsDrafted = 0;
  for (const row of grouped) {
    if (row.reason_code === "good_as_drafted") {
      goodAsDrafted += Number(row.n);
      continue;
    }
    const proposal = statementForReason(row.reason_code, Number(row.n));
    if (!proposal) continue;
    const id = `ledger-rule:${proposal.key}`;
    const existing = await query<{ status: string }>(
      `select status from mychef_inbox.knowledge where workspace_id = $1 and id = $2`,
      [MYCHEF_WORKSPACE, id],
    );
    if (existing[0]?.status === "retired" || existing[0]?.status === "approved") continue;
    const content = `evidence: ${row.n}\ngroup: ${proposal.group}\nreason: ${row.reason_code}\n\n${proposal.statement}`;
    if (existing[0]) {
      await query(
        `update mychef_inbox.knowledge
         set title = $3, content = $4, category = $5, status = 'pending', updated_at = now(), version = version + 1
         where workspace_id = $1 and id = $2`,
        [MYCHEF_WORKSPACE, id, proposal.statement, content, proposal.group],
      );
    } else {
      await query(
        `insert into mychef_inbox.knowledge
           (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'pending', 'business', 'ledger-rule', 1, 'mychef', 'general', now(), now())`,
        [MYCHEF_WORKSPACE, id, proposal.statement, content, proposal.group],
      );
      created += 1;
    }
  }
  const decay = await query(
    `update mychef_inbox.knowledge k
     set status = 'retired', updated_at = now()
     where k.workspace_id = $1
       and k.source = 'ledger-rule'
       and k.status = 'approved'
       and k.updated_at < now() - interval '90 days'
     returning id`,
    [MYCHEF_WORKSPACE],
  );
  return { created, goodAsDrafted, decayed: decay.length };
}

const LEARNABLE_DECISIONS_SQL = `
  d.created_at >= now() - interval '30 days'
  and d.reason_code <> 'auto_sent_candidate'
  and (
    d.human_decision = 'edited'
    or (d.human_decision = 'rejected' and d.reason_code <> 'good_as_drafted')
  )
`;

export async function runLearningPass(actorId: string, db: Db = appPool) {
  const grouped = await rows<{ reason_code: string; n: string }>(
    db,
    `select d.reason_code, count(*)::text as n
     from mychef_inbox.decision_records d
     join mychef_inbox.feedback f on f.id = d.feedback_id
     where d.workspace_id = $1
       and ${LEARNABLE_DECISIONS_SQL}
       and not exists (
         select 1 from mychef_inbox.audit_log a
         where a.workspace_id = d.workspace_id
           and a.record_id = d.id::text
           and a.action = 'learn:processed'
       )
     group by d.reason_code`,
    [MYCHEF_WORKSPACE],
  );

  let proposed = 0;
  let refreshed = 0;
  let skippedGood = 0;
  let clustered = 0;
  let processed = 0;

  for (const row of grouped) {
    const count = Number(row.n);
    if (row.reason_code === "good_as_drafted" || !isLearnableReason(row.reason_code)) {
      skippedGood += count;
      continue;
    }

    const proposal = statementForReason(row.reason_code, count);
    if (!proposal) continue;
    clustered += 1;

    const evidenceRows = await rows<{
      id: string;
      original_draft: string;
      edited_draft: string;
      rationale: string;
    }>(
      db,
      `select d.id::text as id, f.original_draft, f.edited_draft, d.rationale
       from mychef_inbox.decision_records d
       join mychef_inbox.feedback f on f.id = d.feedback_id
       where d.workspace_id = $1
         and d.reason_code = $2
         and ${LEARNABLE_DECISIONS_SQL}
         and not exists (
           select 1 from mychef_inbox.audit_log a
           where a.workspace_id = d.workspace_id
             and a.record_id = d.id::text
             and a.action = 'learn:processed'
         )
       order by d.created_at desc
       limit 3`,
      [MYCHEF_WORKSPACE, row.reason_code],
    );

    const source = isKnowledgeGapReason(row.reason_code) ? "learning-pass" : "ledger-rule";
    const id = `${source}:${proposal.key}`;
    const queueType = queueTypeForReason(row.reason_code);
    const whyLead = evidenceRows[0]?.rationale?.trim() ?? "";
    const snippet = learningSnippet(row.reason_code, whyLead, proposal.statement);
    const content = buildProposalContent({
      evidence: count,
      group: proposal.group,
      reason: row.reason_code,
      queueType,
      snippet,
      diffs: evidenceRows.map((item) => ({
        decisionId: item.id,
        ai: item.original_draft.slice(0, 800),
        human: item.edited_draft.slice(0, 800),
        why: item.rationale.slice(0, 400),
      })),
    });

    const outcome = await proposePendingRow(db, {
      id,
      source,
      title: snippet,
      content,
      category: queueType,
    });
    if (outcome === "created") proposed += 1;
    if (outcome === "refreshed") refreshed += 1;

    const allIds = await rows<{ id: string }>(
      db,
      `select d.id::text as id
       from mychef_inbox.decision_records d
       where d.workspace_id = $1
         and d.reason_code = $2
         and ${LEARNABLE_DECISIONS_SQL}
         and not exists (
           select 1 from mychef_inbox.audit_log a
           where a.workspace_id = d.workspace_id
             and a.record_id = d.id::text
             and a.action = 'learn:processed'
         )`,
      [MYCHEF_WORKSPACE, row.reason_code],
    );
    for (const item of allIds) {
      await rows(
        db,
        `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
         values ($1, $2, 'learn:processed', $3)`,
        [MYCHEF_WORKSPACE, actorId, item.id],
      );
      processed += 1;
    }
  }

  await rows(
    db,
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, 'learn:pass', $3)`,
    [MYCHEF_WORKSPACE, actorId, `clustered:${clustered}:proposed:${proposed}:processed:${processed}`],
  );

  return {
    clustered,
    proposed,
    refreshed,
    skippedGood,
    processed,
    sent: false as const,
    activated: false as const,
  };
}

async function proposePendingRow(
  db: Db,
  input: {
    id: string;
    source: "ledger-rule" | "learning-pass";
    title: string;
    content: string;
    category: string;
  },
) {
  const existing = await rows<{ status: string; source: string }>(
    db,
    `select status, source from mychef_inbox.knowledge where workspace_id = $1 and id = $2`,
    [MYCHEF_WORKSPACE, input.id],
  );
  const row = existing[0];
  if (row && row.status === "approved") return "left" as const;
  if (row && row.source !== input.source) return "left" as const;
  if (row) {
    // Refresh pending cards, or reopen a dismissed (retired) card for new evidence.
    await rows(
      db,
      `update mychef_inbox.knowledge
       set title = $3, content = $4, category = $5, status = 'pending', updated_at = now(), version = version + 1
       where workspace_id = $1 and id = $2 and source = $6 and status in ('pending', 'retired')`,
      [MYCHEF_WORKSPACE, input.id, input.title, input.content, input.category, input.source],
    );
    return "refreshed" as const;
  }
  await rows(
    db,
    `insert into mychef_inbox.knowledge
       (workspace_id, id, title, content, category, status, scope, source, version, project_id, area_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'pending', 'business', $6, 1, 'mychef', 'general', now(), now())`,
    [MYCHEF_WORKSPACE, input.id, input.title, input.content, input.category, input.source],
  );
  return "created" as const;
}

/**
 * Immediate correct→learn path from inbox.
 * After an edit/reject with a learnable reason, upsert one pending Learning Queue
 * card with AI vs human vs why evidence, mark the decision learn:processed.
 * Never approves, never touches the curated 12, never sends.
 */
export async function proposeFromDecision(decisionId: string, actorId: string) {
  const found = await query<{
    id: string;
    reason_code: string;
    human_decision: string;
    rationale: string;
    original_draft: string;
    edited_draft: string;
  }>(
    `select d.id::text as id, d.reason_code, d.human_decision, d.rationale,
            f.original_draft, f.edited_draft
     from mychef_inbox.decision_records d
     join mychef_inbox.feedback f on f.id = d.feedback_id
     where d.workspace_id = $1 and d.id = $2::uuid`,
    [MYCHEF_WORKSPACE, decisionId],
  );
  const decision = found[0];
  if (!decision) return { ok: false as const, error: "That decision is not in this workspace." };

  const already = await query<{ id: string }>(
    `select id::text as id from mychef_inbox.audit_log
     where workspace_id = $1 and record_id = $2 and action = 'learn:processed'
     limit 1`,
    [MYCHEF_WORKSPACE, decision.id],
  );
  if (already[0]) {
    const source = isKnowledgeGapReason(decision.reason_code) ? "learning-pass" : "ledger-rule";
    return {
      ok: true as const,
      queued: false as const,
      id: `${source}:${decision.reason_code}`,
      queueType: queueTypeForReason(decision.reason_code),
    };
  }

  if (
    !isLearnableReason(decision.reason_code) ||
    (decision.human_decision !== "edited" && decision.human_decision !== "rejected")
  ) {
    await query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'learn:processed', $3)`,
      [MYCHEF_WORKSPACE, actorId, decision.id],
    );
    return { ok: true as const, queued: false as const, id: null, queueType: null };
  }

  // The card states how often this reason has been seen, so count the learnable decisions of
  // this reason instead of hardcoding 1. Never below 1: this decision is one of them.
  const counted = await query<{ n: string }>(
    `select count(*)::text as n
     from mychef_inbox.decision_records d
     join mychef_inbox.feedback f on f.id = d.feedback_id
     where d.workspace_id = $1 and d.reason_code = $2 and ${LEARNABLE_DECISIONS_SQL}`,
    [MYCHEF_WORKSPACE, decision.reason_code],
  );
  const proposal = statementForReason(
    decision.reason_code,
    Math.max(1, Number(counted[0]?.n ?? 0)),
  );
  if (!proposal) {
    return { ok: false as const, error: "That reason does not map to a Learning Queue card." };
  }

  const source = isKnowledgeGapReason(decision.reason_code) ? "learning-pass" : "ledger-rule";
  const id = `${source}:${proposal.key}`;
  const queueType = queueTypeForReason(decision.reason_code);
  const newDiff: EvidenceDiff = {
    decisionId: decision.id,
    ai: decision.original_draft.slice(0, 800),
    human: decision.edited_draft.slice(0, 800),
    why: decision.rationale.slice(0, 400),
  };

  const existing = await query<{ content: string; status: string; source: string }>(
    `select content, status, source from mychef_inbox.knowledge
     where workspace_id = $1 and id = $2`,
    [MYCHEF_WORKSPACE, id],
  );
  const prior = existing[0];
  if (prior && prior.status === "approved") {
    await query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'learn:processed', $3)`,
      [MYCHEF_WORKSPACE, actorId, decision.id],
    );
    return {
      ok: true as const,
      queued: false as const,
      id,
      queueType,
      skipped: "already_approved" as const,
    };
  }

  let diffs = [newDiff];
  let evidenceCount = 1;
  if (prior && prior.source === source && (prior.status === "pending" || prior.status === "retired")) {
    const meta = parseProposalMeta(prior.content);
    diffs = [newDiff, ...meta.diffs.filter((d) => d.decisionId !== decision.id)].slice(
      0,
      3,
    );
    const priorEvidence = Number(meta.evidence);
    evidenceCount =
      prior.status === "retired"
        ? 1
        : Number.isFinite(priorEvidence)
          ? priorEvidence + 1
          : diffs.length;
  }

  const snippet = learningSnippet(decision.reason_code, decision.rationale, proposal.statement);
  const content = buildProposalContent({
    evidence: evidenceCount,
    group: proposal.group,
    reason: decision.reason_code,
    queueType,
    snippet,
    diffs,
  });

  await proposePendingRow(appPool, {
    id,
    source,
    title: snippet,
    content,
    category: queueType,
  });
  await query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, 'learn:processed', $3)`,
    [MYCHEF_WORKSPACE, actorId, decision.id],
  );
  await query(
    `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
     values ($1, $2, 'learn:from-inbox', $3)`,
    [MYCHEF_WORKSPACE, actorId, id],
  );

  return { ok: true as const, queued: true as const, id, queueType };
}

/** Approve → situational knowledge. Dismiss → retired. Never edits the curated 12. */
export async function setMychefRuleStatus(
  id: string,
  status: "approved" | "retired",
  actorId: string,
) {
  const rows = await query<{ title: string; content: string; status: string; source: string }>(
    `select title, content, status, source from mychef_inbox.knowledge
     where workspace_id = $1 and id = $2 and source in ('ledger-rule', 'learning-pass', 'situational')`,
    [MYCHEF_WORKSPACE, id],
  );
  const rule = rows[0];
  if (!rule) return { ok: false as const, error: "That candidate is not in this workspace." };
  if (status === "approved" && rule.status !== "pending") {
    return { ok: false as const, error: "Only a pending snippet can be approved." };
  }
  if (status === "approved") {
    await query(
      `update mychef_inbox.knowledge
       set status = 'approved', updated_at = now(), version = version + 1
       where workspace_id = $1 and id = $2
         and source in ('ledger-rule', 'learning-pass', 'situational') and status = 'pending'`,
      [MYCHEF_WORKSPACE, id],
    );
    await query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'snippet:approved', $3)`,
      [MYCHEF_WORKSPACE, actorId, id],
    );
  } else {
    await query(
      `update mychef_inbox.knowledge
       set status = 'retired', updated_at = now(), version = version + 1
       where workspace_id = $1 and id = $2 and source in ('ledger-rule', 'learning-pass', 'situational')`,
      [MYCHEF_WORKSPACE, id],
    );
    await query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'snippet:dismissed', $3)`,
      [MYCHEF_WORKSPACE, actorId, id],
    );
  }
  return { ok: true as const, title: rule.title, content: rule.content };
}

const EVALS = [
  {
    name: "Deposit inside 14 days",
    inbound: "Can I get the deposit back? The dinner is in five days.",
    mustInclude: "non-refundable",
    mustNotInclude: "full refund",
  },
  {
    name: "Allergy",
    inbound: "My guest has a severe allergy. Can you still cook?",
    mustInclude: "allergy",
    mustNotInclude: "we cannot accommodate",
  },
];

export async function runMychefEvals(actorId: string) {
  const results: { name: string; passed: boolean; notes: string }[] = [];
  for (const item of EVALS) {
    const ranked = await rankKnowledge(item.inbound);
    const knowledge = ranked.eligible.slice(0, 4).map((row) => ({
      chunkId: row.doc.id,
      orgId: MYCHEF_WORKSPACE,
      sourceId: row.doc.id,
      title: row.doc.title,
      kind: row.kind,
      excerpt: row.doc.content.slice(0, 700),
      score: row.score,
    }));
    const draft = localStructuredDraft(item.inbound, knowledge, []);
    const passed =
      draft.draftText.toLowerCase().includes(item.mustInclude.toLowerCase()) &&
      !draft.draftText.toLowerCase().includes(item.mustNotInclude.toLowerCase());
    const notes = passed
      ? "Draft matched the case. No provider was called."
      : "Draft did not match the case. No provider was called.";
    await query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, $3, $4)`,
      [MYCHEF_WORKSPACE, actorId, passed ? "eval:pass" : "eval:fail", item.name],
    );
    results.push({ name: item.name, passed, notes });
  }
  return results;
}

export async function listAudit() {
  return query<{ id: string; actor_id: string; action: string; record_id: string; created_at: Date }>(
    `select id::text as id, actor_id, action, record_id, created_at
     from mychef_inbox.audit_log
     where workspace_id = $1
     order by created_at desc
     limit 80`,
    [MYCHEF_WORKSPACE],
  );
}

export async function listMychefKeys() {
  const rows = await query<{
    id: string;
    enabled: boolean;
    config: { hint?: string; base_url?: string } | null;
    updated_at: Date;
    verified_at: Date | null;
    last_error: string | null;
  }>(
    `select id, enabled, config, updated_at, verified_at, last_error
     from mychef_inbox.integration_connections
     where workspace_id = $1 and kind = 'ai' and id = any($2::text[])
     order by id`,
    [MYCHEF_WORKSPACE, PROVIDERS],
  );
  return rows;
}

export async function saveMychefKey(
  provider: Provider,
  secret: string,
  baseUrl: string | null,
  keepBaseUrl = false,
) {
  const trimmed = secret.trim();
  if (trimmed.length < 8) return { ok: false as const, error: "Enter the provider key. It stays on the server." };
  let storedBase = baseUrl;
  if (keepBaseUrl) {
    const existing = await query<{ config: { base_url?: string } | null }>(
      `select config from mychef_inbox.integration_connections
       where workspace_id = $1 and id = $2`,
      [MYCHEF_WORKSPACE, provider],
    );
    storedBase = existing[0]?.config?.base_url ?? null;
  }
  const hint = keyHint(trimmed);
  const encoded = encryptSecret(trimmed).toString("base64");
  await query(
    `insert into mychef_inbox.integration_connections
       (workspace_id, id, kind, label, encrypted_secret, config, enabled, updated_at)
     values ($1, $2, 'ai', $3, $4, $5::jsonb, true, now())
     on conflict (workspace_id, id) do update
       set encrypted_secret = excluded.encrypted_secret,
           config = excluded.config,
           enabled = true,
           label = excluded.label,
           last_error = null,
           updated_at = now()`,
    [
      MYCHEF_WORKSPACE,
      provider,
      PROVIDER_LABELS[provider],
      encoded,
      JSON.stringify({ hint, base_url: storedBase }),
    ],
  );
  return { ok: true as const, hint };
}

export async function revokeMychefKey(provider: Provider) {
  const updated = await query(
    `update mychef_inbox.integration_connections
     set enabled = false, updated_at = now()
     where workspace_id = $1 and id = $2 and kind = 'ai'
     returning id`,
    [MYCHEF_WORKSPACE, provider],
  );
  if (updated.length === 0) return { ok: false as const, error: "No key is stored for that provider." };
  return { ok: true as const };
}

export async function resolveMychefSecret(provider: Provider): Promise<{
  secret: string;
  baseUrl: string | null;
} | null> {
  const rows = await query<{ encrypted_secret: string; config: { base_url?: string } | null }>(
    `select encrypted_secret, config
     from mychef_inbox.integration_connections
     where workspace_id = $1 and id = $2 and kind = 'ai' and enabled = true`,
    [MYCHEF_WORKSPACE, provider],
  );
  const row = rows[0];
  if (!row?.encrypted_secret) return null;
  return {
    secret: decryptSecret(Buffer.from(row.encrypted_secret, "base64")),
    baseUrl: row.config?.base_url ?? null,
  };
}

export async function markMychefKeyChecked(provider: Provider, error: string | null) {
  if (error) {
    await query(
      `update mychef_inbox.integration_connections
       set last_error = $3, updated_at = now()
       where workspace_id = $1 and id = $2`,
      [MYCHEF_WORKSPACE, provider, error.slice(0, 240)],
    );
    return;
  }
  await query(
    `update mychef_inbox.integration_connections
     set verified_at = now(), last_error = null, updated_at = now()
     where workspace_id = $1 and id = $2`,
    [MYCHEF_WORKSPACE, provider],
  );
}
