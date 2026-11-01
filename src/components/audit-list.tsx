/**
 * The audit list, split out of the page so its output can be rendered and asserted in a test.
 * Do not auto-send. The route heading stays in the page (MC-022); this renders the rows only.
 */
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import type { AuditRowView } from "@/lib/audit-view";
import { formatWhen } from "@/lib/format";

export function AuditList({ rows }: { rows: AuditRowView[] }) {
  if (rows.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No audit events</EmptyTitle>
          <EmptyDescription>
          Changes recorded in this workspace will show up here, with the actor.
        </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline">{row.kind}</Badge>
            <span className="text-muted-foreground">{formatWhen(row.when)}</span>
            <span className="text-muted-foreground">
              by{" "}
              <span
                className="break-all font-medium text-foreground"
                data-audit-actor={row.actor}
              >
                {row.actor}
              </span>
            </span>
          </div>
          <p className="break-words">{row.summary}</p>
        </li>
      ))}
    </ul>
  );
}
