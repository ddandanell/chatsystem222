/**
 * Who may sign in. Hashes stay on the server. Do not auto-send.
 */
import { saveOperatorAction } from "@/app/[workspace]/settings/access/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getWorkspaceAccess } from "@/lib/context";
import { listOperators } from "@/lib/operators";
import { canManageKeys } from "@/lib/workspace-access";

export const metadata = { title: "Access" };
export const instant = false;

export default async function AccessPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/settings/access">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const operators = await listOperators();
  const manage = canManageKeys(access.ctx.role);
  const ownerEmail = (process.env.OPERATOR_BOOTSTRAP_EMAIL || "bali@mychef.id").trim().toLowerCase();
  const error = typeof query.error === "string" ? query.error : "";

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-medium tracking-tight">Who can sign in</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Only approved operators open the ledger. Passwords are stored as a scrypt hash. The page never shows them again.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {query.saved === "1" ? (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>Access was updated. The password was not written to the page.</AlertDescription>
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-3">
        {operators.map((operator) => (
          <li key={operator.email} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{operator.name}</p>
              <Badge variant="outline">{operator.role}</Badge>
              <Badge variant={operator.approved ? "secondary" : "outline"}>
                {operator.approved ? "Approved" : "Revoked"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{operator.email}</p>
            {manage && operator.email !== ownerEmail ? (
              <form action={saveOperatorAction.bind(null, access.ctx.orgSlug)} className="flex flex-wrap gap-2">
                <input type="hidden" name="email" value={operator.email} />
                <input type="hidden" name="name" value={operator.name} />
                <input type="hidden" name="role" value={operator.role} />
                <input type="hidden" name="approved" value={operator.approved ? "off" : "on"} />
                <Button type="submit" size="sm" variant="outline">
                  {operator.approved ? "Revoke" : "Approve"}
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <form action={saveOperatorAction.bind(null, access.ctx.orgSlug)} className="flex flex-col gap-4 rounded-xl border p-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="operator-email">Email</FieldLabel>
              <Input id="operator-email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="operator-name">Name</FieldLabel>
              <Input id="operator-name" name="name" autoComplete="off" />
            </Field>
            <Field>
              <FieldLabel htmlFor="operator-password">Password</FieldLabel>
              <Input id="operator-password" name="password" type="password" autoComplete="new-password" />
            </Field>
            <Field>
              <FieldLabel htmlFor="operator-role">Role</FieldLabel>
              <select id="operator-role" name="role" className="h-8 rounded-lg border bg-background px-2 text-sm" defaultValue="reviewer">
                <option value="reviewer">Reviewer</option>
                <option value="viewer">Viewer (read only)</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </Field>
          </FieldGroup>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="approved" value="on" defaultChecked />
            Approved to sign in
          </label>
          <Button type="submit" className="w-fit">Save operator</Button>
        </form>
      ) : null}
    </div>
  );
}
