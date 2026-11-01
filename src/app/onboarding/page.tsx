/**
 * First-workspace screen for the local ledger. Do not auto-send.
 */
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import {
  createWorkspaceAction,
  joinWorkspaceAction,
} from "@/app/onboarding/actions";
import { WorkspaceForms } from "@/app/onboarding/forms";
import { listMyWorkspaces } from "@/lib/workspace-access";

export const metadata = { title: "Workspace" };

export default async function OnboardingPage() {
  await connection();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const workspaces = await listMyWorkspaces(session.user.id, session.user.email);
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 md:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-medium tracking-tight">Choose a workspace</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          A workspace is the tenant. Decisions, keys, and feedback stay inside
          it. Create one you own, or join an existing slug as a viewer.
        </p>
      </div>
      {workspaces.length > 0 ? (
        <ul className="flex flex-col gap-2 text-sm">
          {workspaces.map((workspace) => (
            <li key={workspace.slug}>
              <a className="underline underline-offset-4" href={`/${workspace.slug}/inbox`}>
                {workspace.name}
              </a>
              <span className="text-muted-foreground"> · {workspace.role}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <WorkspaceForms createAction={createWorkspaceAction} joinAction={joinWorkspaceAction} />
    </main>
  );
}
