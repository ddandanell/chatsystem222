/**
 * CBLS Learning Queue helpers.
 *
 * Purpose: map reason codes to queue types (Missing Knowledge, Tone, Outdated,
 * Suggested) and parse AI vs human evidence from proposal content.
 * Tables: reads shapes written into mychef_inbox.knowledge (learning-pass /
 * ledger-rule / situational). Does not auto-activate or send.
 *
 * The code → queue mapping lives in `src/lib/reason-codes.ts`, single table. This module keeps the
 * function names the rest of the app already calls, so there is one place to register a new code.
 * Docs: documentation/cbls-architecture.md
 *       documentation/handoff.md
 *       documentation/learning-queue.md
 */
import { reasonSpec, type ReasonGroup } from "@/lib/reason-codes";

export const QUEUE_TYPES = [
  "Missing Knowledge",
  "Tone",
  "Outdated",
  "Suggested",
] as const;

export type QueueType = (typeof QUEUE_TYPES)[number];

export function queueTypeForReason(reason: string): QueueType {
  return reasonSpec(reason)?.queue ?? "Suggested";
}

export function groupForReason(reason: string): ReasonGroup {
  return reasonSpec(reason)?.group ?? "procedure_gap";
}

export function isKnowledgeGapReason(reason: string): boolean {
  const spec = reasonSpec(reason);
  if (spec) return spec.group === "knowledge_gap";
  return ["wrong_policy", "wrong_fact", "missing_knowledge"].includes(reason);
}

/** Reasons that should become Learning Queue proposals after a correction. */
export function isLearnableReason(reason: string): boolean {
  const spec = reasonSpec(reason);
  if (spec) return spec.learnable;
  return reason !== "good_as_drafted" && reason !== "auto_sent_candidate";
}

/**
 * The candidate statement for a correction code, from the same registry. Returns null only for a
 * code that is not learnable (good as drafted) or not registered at all — and an unregistered code
 * fails `tests/reason-registry.test.ts`, so it cannot be added to the picker without a statement.
 */
export function statementForReason(
  reason: string,
  count: number,
): { key: string; group: ReasonGroup; statement: string } | null {
  const spec = reasonSpec(reason);
  if (!spec || !spec.learnable) return null;
  return {
    key: spec.code,
    group: spec.group,
    statement: `${spec.statement} Reviewers marked ${spec.code} ${count} times.`,
  };
}

export type EvidenceDiff = {
  decisionId: string;
  ai: string;
  human: string;
  why: string;
};

export function parseProposalMeta(content: string): {
  evidence: string;
  group: string;
  reason: string;
  queueType: QueueType;
  snippet: string;
  diffs: EvidenceDiff[];
} {
  const evidence = content.match(/^evidence:\s*(.+)$/m)?.[1]?.trim() ?? "—";
  const group = content.match(/^group:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const reason = content.match(/^reason:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const queueTypeRaw = content.match(/^queue_type:\s*(.+)$/m)?.[1]?.trim();
  const queueType =
    QUEUE_TYPES.find((item) => item === queueTypeRaw) ??
    queueTypeForReason(reason);
  const snippetMatch = content.match(/^snippet:\s*([\s\S]*?)(?=\n---diff|$)/m);
  const snippet =
    snippetMatch?.[1]?.trim() ||
    content.split("\n\n").slice(1).join("\n\n").replace(/\n---diff[\s\S]*$/, "").trim();
  const diffs: EvidenceDiff[] = [];
  const diffBlocks = content.split(/\n---diff\s+/).slice(1);
  for (const block of diffBlocks) {
    const decisionId = block.match(/^decision:([^\n]+)/)?.[1]?.trim() ?? "";
    const ai = block.match(/^AI:\s*([\s\S]*?)(?=\nHuman:|$)/m)?.[1]?.trim() ?? "";
    const human =
      block.match(/^Human:\s*([\s\S]*?)(?=\nWhy:|$)/m)?.[1]?.trim() ?? "";
    const why = block.match(/^Why:\s*([\s\S]*?)$/m)?.[1]?.trim() ?? "";
    if (decisionId || ai || human || why) diffs.push({ decisionId, ai, human, why });
  }
  return { evidence, group, reason, queueType, snippet, diffs };
}

export function buildProposalContent(input: {
  evidence: number;
  group: string;
  reason: string;
  queueType: QueueType;
  snippet: string;
  diffs: EvidenceDiff[];
}): string {
  const parts = [
    `evidence: ${input.evidence}`,
    `group: ${input.group}`,
    `reason: ${input.reason}`,
    `queue_type: ${input.queueType}`,
    "",
    `snippet: ${input.snippet}`,
  ];
  for (const diff of input.diffs.slice(0, 3)) {
    parts.push(
      "",
      `---diff decision:${diff.decisionId}`,
      `AI: ${diff.ai}`,
      `Human: ${diff.human}`,
      `Why: ${diff.why || "—"}`,
    );
  }
  return parts.join("\n");
}

export function learningSnippet(reason: string, why: string, base: string): string {
  const trimmed = why.trim();
  if (!trimmed) return base;
  return `Situational case (${reason}): ${trimmed}`;
}
