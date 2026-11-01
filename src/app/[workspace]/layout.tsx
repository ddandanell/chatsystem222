/**
 * Workspace chrome for the decision console.
 * Purpose: identity header, no-send banner, desktop nav, phone nav.
 * The header streams inside its own Suspense boundary so a phone sees the queue
 * skeleton immediately instead of waiting for auth + membership queries.
 * Do not auto-send.
 */
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction } from "@/app/login/actions";
import { ConsoleNav } from "@/components/console-nav";
import { EnvironmentBadge } from "@/components/environment-badge";
import { MobileNav } from "@/components/mobile-nav";
import { WorkspaceMain } from "@/components/workspace-main";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { readAutopilot } from "@/lib/autopilot";
import { roleLabel } from "@/lib/format";
import { listMyWorkspaces } from "@/lib/workspace-access";

function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b">
      <div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col gap-3 px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-5 w-40 rounded bg-muted" />
          </div>
          <div className="h-9 w-20 rounded bg-muted" />
        </div>
        <div className="h-4 w-full max-w-md rounded bg-muted" />
      </div>
    </header>
  );
}

async function WorkspaceChrome({ workspace }: { workspace: string }) {
  const access = await getWorkspaceAccess(workspace);
  if (access.status === "forbidden") {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Not a member</CardTitle>
            <CardDescription>
              You are signed in, but this session is not a member of {access.orgName}.
              Their decisions stay closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button render={<Link href="/" />} nativeButton={false}>
              Your workspaces
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  const ctx = access.ctx;
  const workspaces = await listMyWorkspaces(ctx.userId, ctx.email);
  const autopilot = usesMychefInbox()
    ? await readAutopilot()
    : { enabled: false, confidenceThreshold: 0.8 };

  return (
    <header className="shrink-0 border-b">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={`/${ctx.orgSlug}/inbox`}
              className="hidden text-sm text-muted-foreground lg:inline"
            >
              Inbox mychef
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {/* The workspace name is a label, not the page heading: it repeated on all 14
                  routes and cost every page its own h1 (MC-022). Same classes, no visual change. */}
              <p className="truncate text-base font-medium sm:text-lg">{ctx.orgName}</p>
              <Badge variant="secondary">{roleLabel(ctx.role)}</Badge>
              <EnvironmentBadge />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="hidden text-sm text-muted-foreground sm:block">
              {ctx.name ?? ctx.email}
            </p>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        {workspaces.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {workspaces.map((item) => (
              <Button
                key={item.slug}
                size="sm"
                variant={item.slug === ctx.orgSlug ? "secondary" : "ghost"}
                render={<Link href={`/${item.slug}/inbox`} />}
                nativeButton={false}
              >
                {item.name}
              </Button>
            ))}
          </div>
        ) : null}
        <ConsoleNav slug={ctx.orgSlug} />
        <p className="text-xs text-muted-foreground sm:text-sm">
          {autopilot.enabled
            ? "Sending is not connected."
            : "Automatic sending is not on. A review stays in the ledger and does not message the client."}
        </p>
      </div>
    </header>
  );
}

export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/[workspace]">) {
  const { workspace } = await params;
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden pb-16 lg:pb-0">
      <Suspense fallback={<HeaderSkeleton />}>
        <WorkspaceChrome workspace={workspace} />
      </Suspense>
      <WorkspaceMain>{children}</WorkspaceMain>
      <MobileNav slug={workspace} />
    </div>
  );
}
