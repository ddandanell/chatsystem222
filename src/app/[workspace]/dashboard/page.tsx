/**
 * Home metrics from mychef_inbox counts. Spend stays zero. Do not auto-send.
 */
import Link from "next/link";
import { sql } from "drizzle-orm";
import { learnPassAction } from "@/app/[workspace]/ledger-actions";
import {
  dashboardCounts,
  dashboardReviewStats,
  listInbox,
  listKnowledgeDrafts,
  listMychefKeys,
} from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { documents } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { readAutopilot } from "@/lib/autopilot";
import { getWorkspaceAccess } from "@/lib/context";
import { excerpt, formatWhenKl } from "@/lib/format";
import { PRIMARY_PROVIDERS, PROVIDER_LABELS } from "@/lib/providers";
import { canReview } from "@/lib/workspace-access";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/dashboard">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const neon = usesMychefInbox();
  const slug = access.ctx.orgSlug;
  const counts = neon ? await dashboardCounts() : await localCounts(access.ctx.orgId);
  const stats = neon
    ? await dashboardReviewStats()
    : { accepted: 0, reviewed: 0, escalations: 0, recentEscalations: [] };
  const autopilot = neon
    ? await readAutopilot()
    : { enabled: false, confidenceThreshold: 0.8 };
  const keys = neon ? await listMychefKeys() : [];
  const recent = neon ? await listInbox("pending_review", 1) : null;
  const drafts = neon ? await listKnowledgeDrafts() : [];
  const groups = drafts.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.group] = (acc[doc.group] ?? 0) + 1;
    return acc;
  }, {});
  const acceptance =
    stats.reviewed === 0 ? "—" : `${Math.round((stats.accepted / stats.reviewed) * 100)}%`;
  const clustered = typeof query.clustered === "string" ? query.clustered : "";
  const proposed = typeof query.proposed === "string" ? query.proposed : "";
  const storedKeys = new Map(keys.map((row) => [row.id, row]));

  const cards = [
    {
      label: "Waiting for review",
      value: String(counts.needsReply),
      detail: "Conversations with no decision yet",
      href: `/${slug}/inbox`,
    },
    {
      label: "Acceptance rate",
      value: acceptance,
      detail:
        stats.reviewed === 0
          ? "No reviewed drafts yet"
          : `${stats.accepted} accepted of ${stats.reviewed} reviews`,
      href: `/${slug}/inbox?status=reviewed`,
    },
    {
      label: "Escalations",
      value: String(stats.escalations),
      detail: "Reviews marked needs a human",
      href: "#escalations",
    },
    {
      label: "Model spend today",
      value: "$0",
      detail: "No provider call is billed from this console",
      href: `/${slug}/settings/keys`,
    },
    {
      label: "Candidate rules",
      value: String(counts.candidates),
      detail: "Pending proposals, not live rules",
      href: `/${slug}/candidates`,
    },
    {
      label: "Knowledge",
      value: String(counts.knowledge),
      detail: "Positions and playbooks already stored",
      href: `/${slug}/knowledge`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {/* The page subject, not the workspace name: the name is the shell label now, and printing
            it again as the largest heading was UX-0203. Classes unchanged, so nothing moved. */}
        <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          What needs you today. Each count opens the list behind it. Nothing on this page sends a reply.
        </p>
      </div>
      {autopilot.enabled ? (
        <Alert>
          <AlertTitle>Sending is not connected.</AlertTitle>
          <AlertDescription>
            Auto-pilot is on at {Math.round(autopilot.confidenceThreshold * 100)}% confidence. It can mark a candidate. It cannot deliver the reply.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>Auto-pilot is off</AlertTitle>
          <AlertDescription>
            Every draft stays pending until a person reviews it. The switch lives in auto-pilot settings.
          </AlertDescription>
        </Alert>
      )}
      {clustered ? (
        <Alert>
          <AlertTitle>Learning pass finished</AlertTitle>
          <AlertDescription>
            Clustered {clustered} recent reasons and proposed {proposed || "0"} pending rows. Nothing was activated and nothing was sent.
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.label}>
            <Link href={card.href} className="block h-full">
              <Card className="h-full">
                <CardHeader>
                  <CardDescription>{card.label}</CardDescription>
                  <CardTitle>{card.value}</CardTitle>
                  <CardDescription>{card.detail}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Provider keys</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRIMARY_PROVIDERS.map((provider) => {
            const row = storedKeys.get(provider);
            const ready = Boolean(row?.enabled);
            return (
              <li key={provider}>
                <Link href={`/${slug}/settings/keys`} className="block">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle>{PROVIDER_LABELS[provider]}</CardTitle>
                        <Badge variant={ready ? "secondary" : "outline"}>
                          {ready ? `•••• ${row?.config?.hint ?? ""}` : "Not stored"}
                        </Badge>
                      </div>
                      <CardDescription>
                        {ready
                          ? `Checked ${formatWhenKl(row?.verified_at)}`
                          : "Add this key before a live model call."}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href={`/${slug}/inbox`} className={cn(buttonVariants({ variant: "default" }), "w-fit")}>
          Open {counts.needsReply} waiting conversations
        </Link>
        <Link href={`/${slug}/settings/autopilot`} className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
          {autopilot.enabled ? "Review auto-pilot" : "Auto-pilot is off"}
        </Link>
        {neon && canReview(access.ctx.role) ? (
          <form action={learnPassAction.bind(null, slug)}>
            <Button type="submit" variant="outline">Run learning pass</Button>
          </form>
        ) : null}
      </div>
      <section id="escalations" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Escalations</h2>
        {stats.recentEscalations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No review has been marked needs a human.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stats.recentEscalations.map((row) => (
              <li key={`${row.conversation_id}-${row.created_at.toISOString()}`}>
                <Link href={`/${slug}/inbox/${row.conversation_id}`} className="text-sm">
                  <span className="font-medium">{row.name ?? "Contact"}</span>
                  <span className="text-muted-foreground"> · {formatWhenKl(row.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {Object.keys(groups).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Knowledge groups</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(groups).map(([group, count]) => (
              <Link
                key={group}
                href={`/${slug}/knowledge?group=${group}`}
                data-tap
                className="inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-sm"
              >
                {group} · {count}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {recent && recent.rows.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Newest conversations that need a reply</h2>
          <ul className="flex flex-col gap-2">
            {recent.rows.slice(0, 6).map((row) => (
              <li key={row.id}>
                <Link
                  href={`/${slug}/inbox/${row.id}`}
                  className="flex min-h-11 items-center gap-1 text-sm"
                >
                  <span className="font-medium">{row.name ?? "Contact"}</span>
                  <span className="text-muted-foreground"> · {excerpt(row.inbound ?? "No inbound text", 90)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

async function localCounts(orgId: string) {
  return withTenant(orgId, async (tx) => {
    const decisions = await tx.execute(
      sql`select count(*) filter (where status = 'pending_review')::int as pending,
             count(*)::int as total
          from decision_records`,
    );
    const knowledge = await tx.select({ id: documents.id }).from(documents);
    const row = decisions.rows[0] as { pending?: number; total?: number } | undefined;
    return {
      needsReply: Number(row?.pending ?? 0),
      decisions: Number(row?.total ?? 0),
      knowledge: knowledge.length,
      contacts: 0,
      messages: 0,
      candidates: 0,
    };
  });
}
