/**
 * Server actions for the myCHEF three-pane desk.
 * Purpose: draft, review (ledger only), tag update → re-draft. Never send.
 * Panes: workspace approve/regenerate/escalate; Client Info tags.
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/cbls-architecture.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
"use server";
/**
 * Neon review, regenerate, and outcome. Tables: drafts, feedback, decision_records. Do not auto-send.
 */

import { revalidatePath } from "next/cache";
import {
  draftForConversation,
  proposeFromDecision,
  recordOutcome,
  reviewConversation,
  updateContactTags,
} from "@/data/mychef-store";
import { getWorkspaceAccess } from "@/lib/context";
import { isLearnableReason } from "@/lib/learning-queue";
import {
  isHumanDecision,
  isReasonCode,
  OUTCOMES,
  type Outcome,
} from "@/lib/reason-codes";
import { canReview } from "@/lib/workspace-access";

export type ActionState = { error?: string; message?: string; id?: string } | null;

export async function draftConversationAction(conversationId: string): Promise<void> {
  const access = await getWorkspaceAccess("mychef");
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  await draftForConversation(conversationId, access.ctx.email || access.ctx.userId);
  revalidatePath(`/mychef/inbox`);
  revalidatePath(`/mychef/inbox/${conversationId}`);
}

export async function updateTagsAction(
  conversationId: string,
  tags: string[],
): Promise<ActionState> {
  const access = await getWorkspaceAccess("mychef");
  if (access.status !== "ok" || !canReview(access.ctx.role)) {
    return { error: "You cannot update tags in this workspace." };
  }
  const saved = await updateContactTags(conversationId, tags);
  if (!saved.ok) return { error: saved.error };
  await draftForConversation(conversationId, access.ctx.email || access.ctx.userId, {
    tagHint: saved.tags.join(" "),
  });
  revalidatePath(`/mychef/inbox/${conversationId}`);
  revalidatePath(`/mychef/inbox`);
  return { message: "Tags saved. Knowledge refreshed and draft regenerated." };
}

export async function reviewConversationAction(
  conversationId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await getWorkspaceAccess("mychef");
  if (access.status !== "ok" || !canReview(access.ctx.role)) {
    return { error: "You cannot review this conversation." };
  }
  const humanDecision = String(formData.get("human_decision") ?? "");
  const reasonCode = String(formData.get("reason_code") ?? "");
  const rationale = String(formData.get("rationale") ?? "").trim();
  const whyNot = String(formData.get("why_not") ?? "").trim();
  const finalText = String(formData.get("final_text") ?? "");
  const remember = formData.get("remember") === "on";
  if (!isHumanDecision(humanDecision)) return { error: "Choose a decision." };
  if (!isReasonCode(reasonCode)) return { error: "Choose a reason code." };
  if (!rationale || !whyNot) {
    return { error: "Say why this reply, and why not the alternative." };
  }
  if (
    (humanDecision === "edited" || humanDecision === "rejected" || humanDecision === "escalated") &&
    !isLearnableReason(reasonCode)
  ) {
    return {
      error:
        "Edits and rejects need a learning reason (not Good as drafted) so the case can enter the Learning Queue.",
    };
  }
  const saved = await reviewConversation(conversationId, access.ctx.email || access.ctx.userId, {
    humanDecision,
    reasonCode,
    rationale,
    whyNot,
    finalText,
    remember,
  });
  if (!saved.ok) return { error: saved.error };
  revalidatePath(`/mychef/inbox`);
  revalidatePath(`/mychef/candidates`);
  // A learnable edit or reject proposes one pending Learning Queue card. It never approves,
  // never touches the curated rows, and never sends.
  let queued = false;
  if (isLearnableReason(reasonCode)) {
    const proposed = await proposeFromDecision(saved.id, access.ctx.email || access.ctx.userId);
    queued = proposed.ok && proposed.queued;
  }
  return {
    message: queued
      ? "Review recorded and a Learning Queue card is pending. Nothing was sent."
      : "Review recorded. Nothing was sent.",
    id: saved.id,
  };
}

export async function outcomeAction(decisionId: string, formData: FormData): Promise<void> {
  const access = await getWorkspaceAccess("mychef");
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  const outcome = String(formData.get("outcome") ?? "");
  if (!OUTCOMES.includes(outcome as Outcome)) return;
  await recordOutcome(decisionId, access.ctx.email || access.ctx.userId, outcome as Outcome);
  revalidatePath(`/mychef/inbox/${decisionId}`);
}
