"use server";
/**
 * Approve or revoke operators. Table: integration_connections. Do not auto-send.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveOperator, type OperatorRole } from "@/lib/operators";
import { operatorRole } from "@/lib/roles";
import { getWorkspaceAccess } from "@/lib/context";
import { canManageKeys } from "@/lib/workspace-access";

function roleOf(value: string): OperatorRole {
  // Type, viewer and an unrecognised value all resolve here, one way, for every caller.
  return operatorRole(value);
}

export async function saveOperatorAction(slug: string, formData: FormData) {
  const access = await getWorkspaceAccess(slug);
  if (access.status !== "ok" || !canManageKeys(access.ctx.role)) {
    redirect(`/${slug}/settings/access?error=You+cannot+change+access.`);
  }
  const saved = await saveOperator({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
    // A form that sends no role must not mint a reviewer. Least privilege is the default.
    role: roleOf(String(formData.get("role") ?? "viewer")),
    approved: formData.get("approved") === "on",
  });
  revalidatePath(`/${slug}/settings/access`);
  if (!saved.ok) {
    redirect(`/${slug}/settings/access?error=${encodeURIComponent(saved.error)}`);
  }
  redirect(`/${slug}/settings/access?saved=1`);
}
