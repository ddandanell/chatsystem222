/**
 * Conversation agent: one focused call, one reply, always a draft. Do not auto-send.
 *
 * Purpose: when an operator opens a conversation and presses Agent, this module builds the
 * context (this conversation only, approved knowledge only), asks the provider, and — if the
 * provider is unavailable, slow, or returns nothing usable — still writes a reply from the local
 * structured draft. A blank draft is never a valid outcome: the desk always gets text to edit.
 * Every result says which path produced it so the reviewer is never misled about provenance.
 * Specs: documentation/agent-spec.md, src/lib/agent-context.ts, src/lib/agent-provider.ts.
 */
import type { SourceRef } from "@/db/schema";
import {
  AGENT_PROMPT_VERSION,
  buildAgentPrompt,
  selectAgentKnowledge,
  selectAgentThread,
  type AgentContext,
} from "@/lib/agent-context";
import {
  completeWithProvider,
  parseAgentOutput,
  type AgentDeps,
  type AgentReply,
} from "@/lib/agent-provider";
import { PROVIDER_LABELS, type Provider } from "@/lib/providers";
import {
  composeLocalReply,
  repeatViolations,
  statesPrice,
  threadBrief,
  type ThreadMessage,
} from "@/lib/thread-memory";

/** Angry, unsafe, legal, refund, VIP or unusual requests are drafted but flagged for a person. */
export const SENSITIVE_PATTERNS: { id: string; pattern: RegExp }[] = [
  {
    id: "allergy",
    pattern:
      /\b(allerg\w*|anaphyla\w*|celiac|coeliac|nut[- ]free|gluten[- ]free|shellfish|dairy[- ]free|vegan|intoleran\w*)\b/i,
  },
  {
    id: "complaint",
    pattern:
      /\b(complaint\w*|complain\w*|disgusting|terrible|unacceptable|awful|refunds?|money back|chargeback)\b/i,
  },
  {
    id: "legal",
    pattern:
      /\b(lawyers?|attorneys?|solicitors?|sue|suing|lawsuit|legal action|health department|police)\b/i,
  },
  {
    id: "safety",
    pattern: /\b(food poisoning|food safety|got sick|illness|hospitali[sz]\w*|hygiene)\b/i,
  },
  {
    id: "vip",
    pattern: /\b(vips?|celebrit\w*|president|minister|billionaire|private jet|security team)\b/i,
  },
  {
    id: "press",
    pattern: /\b(journalists?|press|interview|article about|magazine|tv crew)\b/i,
  },
];

export function sensitiveReasons(text: string): string[] {
  return SENSITIVE_PATTERNS.filter((item) => item.pattern.test(text)).map((item) => item.id);
}

export type AgentDraft = {
  draftText: string;
  why: string;
  whyNot: string;
  /** null = no numeric confidence is claimed. A lexical score is not a probability. */
  confidence: number | null;
  sourceRefs: SourceRef[];
  escalate: boolean;
  /** "local" means no provider answered; the text is still a reply, not an approval. */
  provider: Provider | "local";
  model: string;
  fellBack: boolean;
  notice: string | null;
  latencyMs: number;
  promptVersion: string;
  /** How much of the thread this draft was built from (MC-169). Never estimated. */
  thread: {
    messagesRead: number;
    inbound: number;
    outbound: number;
    firstAt: string | null;
    lastAt: string | null;
  };
};

export type AgentRunDeps = AgentDeps & { orgId: string };

function lastInbound(ctx: AgentContext): string {
  const thread = selectAgentThread(ctx);
  const inbound = [...thread].reverse().find((message) => message.direction === "inbound");
  return (inbound ?? thread[thread.length - 1])?.body ?? "";
}

/**
 * Deterministic reply used when no provider answers.
 *
 * MC-169/170: it is grounded on the whole thread, not on the last inbound message, so a guest who
 * already gave the date and the party size is not asked for them again, and it does not greet a
 * thread myCHEF has already written in. With no approved source it says in plain words that it
 * cannot confirm a price instead of leaving the operator a placeholder to rewrite.
 */
export function localAgentReply(
  knowledge: ReturnType<typeof selectAgentKnowledge>,
  inbound: string,
  thread?: ThreadMessage[],
): { text: string; why: string; whyNot: string; asked: string[] } {
  const messages =
    thread && thread.length > 0
      ? thread
      : [{ direction: "inbound", body: inbound, id: "inbound" } satisfies ThreadMessage];
  return composeLocalReply(knowledge, messages);
}

/**
 * The desk guard over a provider answer (MC-170). A model can greet a thread that has already been
 * greeted, re-ask a question the guest answered two messages ago, reuse the sentence we sent
 * yesterday, or put a price on the screen with no approved source behind it. The draft is refused
 * and the local reply is written instead, with the reason named for the reviewer.
 */
export function providerReplyProblems(
  reply: string,
  thread: ThreadMessage[],
  knowledgeCount: number,
): string[] {
  const problems: string[] = repeatViolations(reply, thread).map((violation) => violation.code);
  if (knowledgeCount === 0 && statesPrice(reply)) problems.push("unbacked_price");
  return [...new Set(problems)];
}

function sourcesFrom(knowledge: ReturnType<typeof selectAgentKnowledge>): SourceRef[] {
  return knowledge.slice(0, 3).map((block) => ({
    id: block.id,
    title: block.title,
    kind: block.kind,
  }));
}

/**
 * Always resolves to a draft with text. `fellBack` is true when the local path wrote it, and the
 * notice says why in words a reviewer can act on — never a credential, never a raw provider body.
 */
export async function runConversationAgent(
  ctx: AgentContext,
  deps: AgentRunDeps,
): Promise<AgentDraft> {
  const knowledge = selectAgentKnowledge(ctx.ranked);
  const inbound = lastInbound(ctx);
  const flags = sensitiveReasons(inbound);
  const escalateForSafety = flags.length > 0;
  const thread = selectAgentThread(ctx);
  const brief = threadBrief(thread);
  const threadReport = {
    messagesRead: brief.messagesRead,
    inbound: brief.inbound,
    outbound: brief.outbound,
    firstAt: brief.firstAt,
    lastAt: brief.lastAt,
  };
  const prompt = buildAgentPrompt(ctx);
  const completion = await completeWithProvider(ctx.workspaceId, prompt, deps);

  // Hoisted: the refusal notice below has to name what the guard caught, and that decision is made
  // inside this branch.
  let parsed: AgentReply | null = null;
  let problems: string[] = [];
  if (completion.ok) {
    parsed = parseAgentOutput(completion.text);
    problems = parsed ? providerReplyProblems(parsed.reply, thread, knowledge.length) : [];
    if (parsed && problems.length === 0) {
      const escalate = escalateForSafety || parsed.escalate;
      return {
        draftText: parsed.reply,
        why:
          parsed.why ||
          `Drafted by ${PROVIDER_LABELS[completion.provider]} (${completion.model}) from ${knowledge.length} approved source${knowledge.length === 1 ? "" : "s"}.`,
        whyNot:
          parsed.whyNot ||
          "The model was told not to promise a price, a menu, availability or a discount without an approved source.",
        confidence: null,
        sourceRefs: sourcesFrom(knowledge),
        escalate,
        provider: completion.provider,
        model: completion.model,
        fellBack: false,
        notice: escalateForSafety
          ? `Flagged for a person: ${flags.join(", ")}. The draft is still a draft; nothing is sent.`
          : null,
        latencyMs: completion.latencyMs,
        promptVersion: AGENT_PROMPT_VERSION,
        thread: threadReport,
      };
    }
  }

  const local = localAgentReply(knowledge, inbound, thread);
  const reason = completion.ok
    ? parsed
      ? PROVIDER_LABELS[completion.provider] +
        " answered, but the desk guard refused it (" +
        problems.join(", ") +
        "), so the local draft was written instead."
      : "The provider answer was not usable JSON, so the local draft was written instead."
    : completion.error;
  return {
    draftText: local.text,
    why: local.why,
    whyNot: local.whyNot,
    confidence: null,
    sourceRefs: sourcesFrom(knowledge),
    escalate: escalateForSafety,
    provider: "local",
    model: "local",
    fellBack: true,
    notice: `${reason} This is the local fallback draft: edit it before approving. Nothing is sent.`,
    latencyMs: 0,
    promptVersion: AGENT_PROMPT_VERSION,
    thread: threadReport,
  };
}
