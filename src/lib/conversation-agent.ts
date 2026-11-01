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
};

export type AgentRunDeps = AgentDeps & { orgId: string };

function lastInbound(ctx: AgentContext): string {
  const thread = selectAgentThread(ctx);
  const inbound = [...thread].reverse().find((message) => message.direction === "inbound");
  return (inbound ?? thread[thread.length - 1])?.body ?? "";
}

function quoteLine(excerpt: string): string {
  const first = excerpt
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line && line.length > 20)[0];
  return (first ?? excerpt).split(/(?<=\.)\s/)[0]?.trim().slice(0, 260) ?? "";
}

export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Deterministic reply used when no provider answers. It never states a price, a menu or a date it
 * cannot support: with approved knowledge it quotes one line and asks for the detail needed to
 * confirm; without knowledge it acknowledges and asks for the details a person needs.
 */
export function localAgentReply(
  knowledge: ReturnType<typeof selectAgentKnowledge>,
  inbound: string,
): { text: string; why: string; whyNot: string } {
  const position = knowledge.find((block) => block.kind === "position") ?? knowledge[0];
  const asksDate = /\b(date|when|day|month|night)\b/i.test(inbound);
  const asksGuests = /\b(guest|people|pax|persons|adults|children|how many)\b/i.test(inbound);
  const parts: string[] = [];
  if (!asksDate) parts.push("the date you have in mind");
  if (!asksGuests) parts.push("the number of guests");
  parts.push("the villa or area you are staying in");
  const ask = `Could you confirm ${joinList(parts)}?`;
  if (position) {
    const quote = quoteLine(position.excerpt);
    return {
      text: `Thank you for reaching out. ${quote ? `${quote} ` : ""}${ask} That way we can put the right menu together for you.`,
      why: `No provider answered, so this is the local draft. It quotes the approved source "${position.title}" and asks for the detail needed to confirm.`,
      whyNot:
        "It does not quote a price, a menu or availability: those are not in an approved source for this message.",
    };
  }
  return {
    text: `Thank you for your message. To give you an exact answer I need ${joinList(parts)}. Once I have those, I will come back with the menu and the price.`,
    why: "No provider answered and no approved source matches this project yet, so this is the local draft. It asks for the details a person needs and states no facts.",
    whyNot:
      "It states no price, menu, date or availability, because none of those is approved for this project.",
  };
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
  const prompt = buildAgentPrompt(ctx);
  const completion = await completeWithProvider(ctx.workspaceId, prompt, deps);

  if (completion.ok) {
    const parsed: AgentReply | null = parseAgentOutput(completion.text);
    if (parsed) {
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
      };
    }
  }

  const local = localAgentReply(knowledge, inbound);
  const reason = completion.ok
    ? "The provider answer was not usable JSON, so the local draft was written instead."
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
  };
}
