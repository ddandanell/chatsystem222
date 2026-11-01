/**
 * Who can sign in to this workspace.
 *
 * On the mychef inbox the directory is the operator rows in integration_connections, not a separate
 * membership table. This page is read-only on purpose: it never creates or changes an operator, and
 * it states no assumption about the reader's own role — a reviewer reading it is not told they are
 * the owner. Do not auto-send.
 */
import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appDb } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { roleLabel } from "@/lib/format";
import { listOperators } from "@/lib/operators";
import { canManageKeys, operatorStatus } from "@/lib/roles";

export const metadata = { title: "Team" };

const STATUS_LABEL = {
  active: "Active",
  "awaiting-approval": "Awaiting approval",
  disabled: "Disabled",
} as const;

const STATUS_VARIANT = {
  active: "secondary",
  "awaiting-approval": "outline",
  disabled: "outline",
} as const;

export default async function TeamPage({
  params,
}: PageProps<"/[workspace]/team">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  if (usesMychefInbox()) {
    const operators = await listOperators();
    const owner = operators.find((row) => row.role === "owner" && row.approved);
    const manage = canManageKeys(access.ctx.role);
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-medium tracking-tight">Team</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Everyone who can sign in to this console, and whether their access is active.
            {manage
              ? " Roles and passwords are changed on the Access page."
              : " Only an owner or an admin can change this list."}
            {owner ? ` Operators are managed by ${owner.email}.` : ""}
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operators.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No operator accounts are readable from this session.
                </TableCell>
              </TableRow>
            ) : (
              operators.map((row) => {
                const status = operatorStatus(row);
                return (
                  <TableRow key={row.email}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        {row.name}
                        {row.email === access.ctx.email.toLowerCase() ? (
                          <Badge variant="outline">You</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{roleLabel(row.role)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    );
  }
  const rows = await appDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, access.ctx.orgId));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-medium tracking-tight">Team</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Membership is read from this workspace only. Invites and role changes
          are not in this slice.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name ?? "—"}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell>
                <Badge variant="secondary">{roleLabel(row.role)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
