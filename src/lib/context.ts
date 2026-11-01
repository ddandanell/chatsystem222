/**
 * Resolves the signed-in workspace from the URL. Do not auto-send.
 */
import { cache } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { authorizeWorkspace, type WorkspaceAccess } from "@/lib/workspace-access";

/**
 * Deduplicated per request: the workspace layout and every page under it call
 * this, and each call used to repeat the session and operator queries.
 */
export const getWorkspaceAccess = cache(
  async (slug: string): Promise<Exclude<WorkspaceAccess, { status: "unknown" }>> => {
    await connection();
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) redirect("/login");
    const access = await authorizeWorkspace(userId, slug, {
      email: session?.user?.email,
      name: session?.user?.name,
    });
    if (access.status === "unknown") notFound();
    return access;
  },
);
