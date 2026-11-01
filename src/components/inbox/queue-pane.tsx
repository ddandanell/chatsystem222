/**
 * Left pane — searchable conversation queue (w-80, muted).
 * Purpose: Needs Review / Escalated / Auto-Sent / All with status badges.
 * Specs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-design-system.md
 *        /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/inbox-ux.md
 */
import Link from "next/link";
import { InboxIcon, SearchIcon } from "lucide-react";
import { CategoryBadge, ConfidenceDot } from "@/components/inbox/category-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { DeskFilter, DeskQueueItem } from "@/data/mychef-store";
import { excerpt, formatWhen, initials } from "@/lib/format";
import { cn } from "cn";

const FILTERS: { id: DeskFilter; label: string }[] = [
  { id: "needs_review", label: "Needs Review" },
  { id: "escalated", label: "Escalated" },
  { id: "auto_sent", label: "Auto-Sent" },
  { id: "all", label: "All" },
];

function statusLabel(filterBucket: DeskFilter): string {
  if (filterBucket === "needs_review") return "Needs review";
  if (filterBucket === "escalated") return "Escalated";
  if (filterBucket === "auto_sent") return "Auto-sent";
  return "Open";
}

export function QueuePane({
  slug,
  filter,
  search,
  rows,
  activeId,
  total,
  page,
  pageSize,
}: {
  slug: string;
  filter: DeskFilter;
  search: string;
  rows: DeskQueueItem[];
  activeId: string | null;
  total: number;
  page: number;
  pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function hrefFor(next: { filter?: DeskFilter; q?: string; page?: number; id?: string | null }) {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    if (f !== "needs_review") params.set("filter", f);
    const q = next.q ?? search;
    if (q) params.set("q", q);
    if ((next.page ?? page) > 1) params.set("page", String(next.page ?? page));
    const query = params.toString();
    const base = next.id ? `/${slug}/inbox/${next.id}` : `/${slug}/inbox`;
    return query ? `${base}?${query}` : base;
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col bg-muted/50">
      <div className="flex flex-col gap-4 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium tracking-tight">Queue</h2>
          <Badge variant="secondary">{total}</Badge>
        </div>
        <form className="flex gap-2" action={`/${slug}/inbox`}>
          {filter !== "needs_review" ? <input type="hidden" name="filter" value={filter} /> : null}
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={search}
              placeholder="Search contacts"
              className="bg-background pl-8"
              aria-label="Search contacts"
            />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Link
              key={item.id}
              href={hrefFor({ filter: item.id, page: 1, id: null })}
              data-tap
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                filter === item.id
                  ? "bg-foreground text-background"
                  : "border border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <ul className="flex flex-col">
            {rows.length === 0 ? (
              <li className="px-4 py-8">
                <Empty className="border border-dashed py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <InboxIcon />
                    </EmptyMedia>
                    <EmptyTitle>Nothing in this filter</EmptyTitle>
                    <EmptyDescription>
                      {search
                        ? "No conversations match this search."
                        : filter === "needs_review"
                          ? "No threads waiting for review."
                          : "Try another filter or search."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </li>
            ) : (
              rows.map((row) => {
                const active = row.id === activeId;
                const href =
                  row.kind === "decision"
                    ? `/${slug}/inbox/${row.id}?filter=${filter}${search ? `&q=${encodeURIComponent(search)}` : ""}`
                    : hrefFor({ id: row.id });
                return (
                  <li key={row.id}>
                    <Link
                      href={href}
                      data-desk-id={row.id}
                      className={cn(
                        "flex gap-3 border-b border-border/60 px-4 py-4 transition-colors focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                        active
                          ? "border-l-2 border-l-primary bg-background"
                          : "border-l-2 border-l-transparent hover:bg-background/70",
                      )}
                    >
                      <Avatar size="sm" className="mt-0.5">
                        <AvatarFallback>{initials(row.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-sm",
                              row.unread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {row.name ?? "Contact"}
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            <ConfidenceDot confidence={row.confidence} />
                            <span className="text-xs text-muted-foreground">
                              {formatWhen(row.when)}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {excerpt(row.snippet || "No inbound text", 90)}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {statusLabel(row.filterBucket)}
                          </Badge>
                          {row.categories.map((id) => (
                            <CategoryBadge key={id} id={id} />
                          ))}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </ScrollArea>
      </div>

      {pages > 1 ? (
        <>
          <Separator />
          <nav className="flex flex-wrap gap-2 p-4">
            {Array.from({ length: Math.min(pages, 8) }, (_, index) => index + 1).map((number) => (
              <Link
                key={number}
                href={hrefFor({ page: number, id: activeId })}
                className={cn(
                  "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  number === page
                    ? "bg-foreground text-background"
                    : "border border-border bg-background hover:bg-muted",
                )}
              >
                {number}
              </Link>
            ))}
          </nav>
        </>
      ) : null}
    </aside>
  );
}
