"use server";
/**
 * Learning pass and rule status. Writes pending knowledge only. Do not auto-send.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  runLearningPass,
  runMychefEvals,
  runMychefLearning,
  setKnowledgeStatus,
  setMychefRuleStatus,
} from "@/data/mychef-store";
import { getWorkspaceAccess } from "@/lib/context";
import { runWorkspaceEvals } from "@/lib/eval-runner";
import { runLearningLoop, setRuleStatus } from "@/lib/learning-loop";
import { usesMychefInbox } from "@/db/mode";
import { canReview } from "@/lib/workspace-access";

export async function learnAction(slug: string) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  if (usesMychefInbox()) {
    await runMychefLearning(access.ctx.email || access.ctx.userId);
  } else {
    await runLearningLoop(access.ctx.orgId, access.ctx.userId);
  }
  revalidatePath(`/${slug}/candidates`);
}

export async function learnPassAction(slug: string) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  if (!usesMychefInbox()) return;
  const result = await runLearningPass(access.ctx.email || access.ctx.userId);
  revalidatePath(`/${slug}/candidates`);
  revalidatePath(`/${slug}/dashboard`);
  redirect(
    `/${slug}/candidates?clustered=${result.clustered}&proposed=${result.proposed}&refreshed=${result.refreshed}&processed=${result.processed}`,
  );
}

export async function ruleStatusAction(slug: string, formData: FormData) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  if (usesMychefInbox()) {
    if (status !== "approved" && status !== "retired") return;
    await setMychefRuleStatus(id, status, access.ctx.email || access.ctx.userId);
  } else if (status === "active" || status === "deprecated") {
    await setRuleStatus(access.ctx.orgId, id, status);
  }
  revalidatePath(`/${slug}/candidates`);
}

export async function knowledgeStatusAction(slug: string, formData: FormData) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) return;
  if (status !== "pending" && status !== "approved" && status !== "retired") return;
  if (!usesMychefInbox()) return;
  await setKnowledgeStatus(id, status, access.ctx.email || access.ctx.userId);
  revalidatePath(`/${slug}/knowledge`);
  revalidatePath(`/${slug}/candidates`);
}

export async function evalAction(slug: string) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canReview(access.ctx.role)) return;
  if (usesMychefInbox()) {
    await runMychefEvals(access.ctx.email || access.ctx.userId);
  } else {
    await runWorkspaceEvals(access.ctx.orgId);
  }
  revalidatePath(`/${slug}/evals`);
}
