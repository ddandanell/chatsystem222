import Link from "next/link";
import { desc } from "drizzle-orm";
import {
  knowledgeStatusAction,
  learnAction,
  learnPassAction,
  ruleStatusAction,
} from "@/app/[workspace]/ledger-actions";
import { listKnowledgeDrafts, listLearningQueue } from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { rules } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { getWorkspaceAccess } from "@/lib/context";
import { QUEUE_TYPES, type QueueType } from "@/lib/learning-queue";
import { canReview } from "@/lib/workspace-access";

export const metadata = { title: "Learning Queue" };

function asQueueFilter(value: string | undefined): QueueType | "all" {
  if (!value || value === "all") return "all";
  return QUEUE_TYPES.find((item) => item === value) ?? "all";
}

export default async function CandidatesPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/candidates">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const neon = usesMychefInbox();
  const filter = asQueueFilter(
    typeof query.type === "string" ? query.type : undefined,
  );
  const highlight =
    typeof query.highlight === "string" ? query.highlight : null;
  const fromInbox = query.from === "inbox";
  const learn = learnAction.bind(null, access.ctx.orgSlug);
  const pass = learnPassAction.bind(null, access.ctx.orgSlug);
  const update = ruleStatusAction.bind(null, access.ctx.orgSlug);
  // Imported and curated rows are reviewed here too: the queue only ever shows proposals.
  const knowledge = neon ? await listKnowledgeDrafts() : [];
  const mark = knowledgeStatusAction.bind(null, access.ctx.orgSlug);

  const clustered = typeof query.clustered === "string" ? query.clustered : null;
  const proposed = typeof query.proposed === "string" ? query.proposed : null;
  const refreshed = typeof query.refreshed === "string" ? query.refreshed : null;
  const processed =
    typeof query.processed === "string" ? query.processed : null;

  if (!neon) {
    const rows = await withTenant(access.ctx.orgId, async (tx) => {
      return tx.select().from(rules).orderBy(desc(rules.createdAt));
    });
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium tracking-tight">Learning queue</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Local rules candidates only. Nothing activates itself, and nothing is sent.
            </p>
          </div>
          {canReview(access.ctx.role) ? (
            <form action={learn}>
              <Button type="submit">Run learning loop</Button>
            </form>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No candidate rules</EmptyTitle>
              <EmptyDescription>
                Record a few reviews, then run the loop.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((rule) => (
              <li key={rule.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{rule.status}</Badge>
                  <Badge variant="outline">{rule.scope}</Badge>
                  <span className="text-sm text-muted-foreground">
                    evidence {rule.evidenceCount}
                  </span>
                </div>
                <p className="text-sm">{rule.statement}</p>
                {canReview(access.ctx.role) ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={update}>
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="status" value="active" />
                      <Button type="submit" size="sm" variant="outline">
                        Activate
                      </Button>
                    </form>
                    <form action={update}>
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="status" value="deprecated" />
                      <Button type="submit" size="sm" variant="ghost">
                        Deprecate
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const cards = await listLearningQueue(filter);
  const pending = cards.filter((card) => card.status === "pending");
  const rest = cards.filter((card) => card.status !== "pending");
  const orderedPending = highlight
    ? [
        ...pending.filter((card) => card.id === highlight),
        ...pending.filter((card) => card.id !== highlight),
      ]
    : pending;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium tracking-tight">Learning queue</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Inbox corrections land here as situational snippets. Approve embeds the
            case into knowledge. Dismiss retires it. The curated library stays
            untouched. Nothing auto-activates and nothing is sent.
          </p>
        </div>
        {canReview(access.ctx.role) ? (
          <div className="flex flex-wrap gap-2">
            <form action={pass}>
              <Button type="submit">Run learning pass</Button>
            </form>
          </div>
        ) : null}
      </div>

      {fromInbox && highlight ? (
        <Alert>
          <AlertTitle>Correction queued from inbox</AlertTitle>
          <AlertDescription>
            Review the highlighted snippet. Approve Snippet stores it as situational
            knowledge. Dismiss retires it. Nothing was sent.
          </AlertDescription>
        </Alert>
      ) : null}

      {clustered !== null ? (
        <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
          Last pass clustered {clustered} reason group
          {clustered === "1" ? "" : "s"}, proposed {proposed ?? "0"}, refreshed{" "}
          {refreshed ?? "0"}, marked {processed ?? "0"} decisions processed. No send.
          No auto-activate.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <FilterChip slug={workspace} label="All" type="all" active={filter === "all"} />
        {QUEUE_TYPES.map((type) => (
          <FilterChip
            key={type}
            slug={workspace}
            label={type}
            type={type}
            active={filter === type}
          />
        ))}
      </div>

      {orderedPending.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No pending snippets</EmptyTitle>
            <EmptyDescription>
              Edit a draft in the inbox with a learning reason and why — the case
              appears here. Cron also clusters unprocessed edits nightly.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-4">
          {orderedPending.map((card) => {
            const isHighlight = highlight === card.id;
            return (
              <li
                key={card.id}
                id={`snippet-${card.id}`}
                className={
                  isHighlight
                    ? "flex flex-col gap-4 rounded-xl border-2 border-foreground px-4 py-4"
                    : "flex flex-col gap-4 rounded-xl border px-4 py-4"
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{card.queueType}</Badge>
                  <Badge variant="secondary">{card.status}</Badge>
                  <Badge variant="outline">{card.source}</Badge>
                  {isHighlight ? <Badge variant="outline">From inbox</Badge> : null}
                  <span className="text-sm text-muted-foreground">
                    evidence {card.evidence}
                    {card.reason ? ` · ${card.reason}` : ""}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Proposed snippet</p>
                  <p className="text-sm leading-6">{card.snippet}</p>
                </div>
                {card.diffs.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">Evidence diff</p>
                    {card.diffs.map((diff) => (
                      <div
                        key={`${card.id}-${diff.decisionId}`}
                        className="flex flex-col gap-3 rounded-lg bg-muted/40 px-3 py-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              AI draft
                            </span>
                            <p className="text-sm leading-6 text-muted-foreground line-through decoration-1">
                              {diff.ai || "—"}
                            </p>
                          </div>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              Human final
                            </span>
                            <p className="text-sm leading-6">{diff.human || "—"}</p>
                          </div>
                        </div>
                        {diff.why ? (
                          <div className="flex flex-col gap-1 border-t border-border/60 pt-2">
                            <span className="text-xs uppercase tracking-wide text-muted-foreground">
                              Why
                            </span>
                            <p className="text-sm leading-6">{diff.why}</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {canReview(access.ctx.role) ? (
                  <div className="flex flex-wrap gap-2">
                    <form action={update}>
                      <input type="hidden" name="id" value={card.id} />
                      <input type="hidden" name="status" value="approved" />
                      <Button type="submit" size="sm">
                        Approve Snippet
                      </Button>
                    </form>
                    <form action={update}>
                      <input type="hidden" name="id" value={card.id} />
                      <input type="hidden" name="status" value="retired" />
                      <Button type="submit" size="sm" variant="ghost">
                        Dismiss
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {rest.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Resolved snippets</h2>
          <ul className="flex flex-col gap-3">
            {rest.map((card) => (
              <li key={card.id} className="flex flex-col gap-2 rounded-xl border px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{card.queueType}</Badge>
                  <Badge variant="secondary">{card.status}</Badge>
                  <Badge variant="outline">{card.source}</Badge>
                </div>
                <p className="text-sm">{card.snippet}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {neon ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Knowledge drafts</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Imported and curated rows. Approving or retiring changes status only; the row stays in
            the table, and only an approved row inside this project can be quoted in a draft.
          </p>
          {knowledge.length === 0 ? (
            <p className="text-sm text-muted-foreground">No knowledge rows yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {knowledge.map((doc) => (
                <li key={doc.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{doc.group}</Badge>
                    <Badge variant="secondary">{doc.status}</Badge>
                    <span className="text-sm text-muted-foreground">{doc.title}</span>
                  </div>
                  {canReview(access.ctx.role) ? (
                    <div className="flex flex-wrap gap-2">
                      <form action={mark}>
                        <input type="hidden" name="id" value={doc.id} />
                        <input type="hidden" name="status" value="approved" />
                        <Button type="submit" size="sm" variant="outline">
                          Approve
                        </Button>
                      </form>
                      <form action={mark}>
                        <input type="hidden" name="id" value={doc.id} />
                        <input type="hidden" name="status" value="retired" />
                        <Button type="submit" size="sm" variant="ghost">
                          Retire
                        </Button>
                      </form>
                      {doc.status !== "pending" ? (
                        <form action={mark}>
                          <input type="hidden" name="id" value={doc.id} />
                          <input type="hidden" name="status" value="pending" />
                          <Button type="submit" size="sm" variant="ghost">
                            Return to pending
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function FilterChip({
  slug,
  label,
  type,
  active,
}: {
  slug: string;
  label: string;
  type: string;
  active: boolean;
}) {
  const href =
    type === "all"
      ? `/${slug}/candidates`
      : `/${slug}/candidates?type=${encodeURIComponent(type)}`;
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-foreground px-3 py-1 text-xs text-background"
          : "rounded-full border px-3 py-1 text-xs text-muted-foreground"
      }
    >
      {label}
    </Link>
  );
}
