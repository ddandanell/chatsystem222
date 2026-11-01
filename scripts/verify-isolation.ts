/**
 * Read-only isolation evidence for `mychef_inbox`. Writes nothing, sends nothing.
 *
 * The audit finding: all 19 live tables had RLS disabled and `mychef_runtime` had no CREATE
 * privilege, so "workspace isolation" was application filtering only. This script produces the
 * evidence a reviewer can re-run before and after the additive owner-run migration.
 *
 * Default: report and exit 0 (so it is safe to run while the gap is still open).
 * `--strict`: exit 1 unless the database itself enforces isolation. That flag is the acceptance
 * test for step C — it must pass after the owner installs RLS, and it must NOT be added to CI
 * before then.
 *
 * Run: npm run verify:isolation   (needs DATABASE_URL for role mychef_runtime)
 */
import { appPool } from "../src/db/client";

type TableRow = {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policies: number;
  has_workspace_id: boolean;
};

type PolicyRow = {
  table_name: string;
  policy_name: string;
  command: string;
  roles: string;
  using_expression: string | null;
  check_expression: string | null;
};

const STRICT = process.argv.includes("--strict");

async function main() {
  const role = await appPool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
  }>(
    `select rolname, rolsuper, rolbypassrls, rolcreatedb
     from pg_roles where rolname = current_user`,
  );
  const currentRole = role.rows[0];

  const schema = await appPool.query<{ schema: string; can_create: boolean; can_use: boolean }>(
    `select nspname as schema,
            has_schema_privilege(current_user, nspname, 'CREATE') as can_create,
            has_schema_privilege(current_user, nspname, 'USAGE') as can_use
     from pg_namespace where nspname = 'mychef_inbox'`,
  );

  const tables = await appPool.query<TableRow>(
    `select c.relname as table_name,
            c.relrowsecurity as rls_enabled,
            c.relforcerowsecurity as rls_forced,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
            exists (
              select 1 from information_schema.columns col
              where col.table_schema = 'mychef_inbox'
                and col.table_name = c.relname
                and col.column_name = 'workspace_id'
            ) as has_workspace_id
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'mychef_inbox' and c.relkind in ('r', 'p')
     order by c.relname`,
  );

  const policies = await appPool.query<PolicyRow>(
    `select c.relname as table_name, p.polname as policy_name, p.polcmd as command,
            array_to_string(array(select rolname from pg_roles where oid = any(p.polroles)), ',') as roles,
            pg_get_expr(p.polqual, p.polrelid) as using_expression,
            pg_get_expr(p.polwithcheck, p.polrelid) as check_expression
     from pg_policy p
     join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'mychef_inbox'
     order by c.relname, p.polname`,
  );

  // Application-scope evidence only: proves the current data is single-workspace, not that the
  // database would refuse a second one. Printed so nobody mistakes the two.
  const crossWorkspace = await appPool.query<{ table_name: string; rows: number }>(
    `select 'knowledge' as table_name, count(*)::int as rows
       from mychef_inbox.knowledge where workspace_id is distinct from 'mychef'
     union all
     select 'conversations', count(*)::int
       from mychef_inbox.conversations where workspace_id is distinct from 'mychef'
     union all
     select 'contacts', count(*)::int
       from mychef_inbox.contacts where workspace_id is distinct from 'mychef'
     union all
     select 'drafts', count(*)::int
       from mychef_inbox.drafts where workspace_id is distinct from 'mychef'`,
  );

  const total = tables.rows.length;
  const withRls = tables.rows.filter((table) => table.rls_enabled).length;
  const withPolicies = tables.rows.filter((table) => table.policies > 0).length;
  const withoutWorkspaceColumn = tables.rows
    .filter((table) => !table.has_workspace_id)
    .map((table) => table.table_name);
  const dbEnforced = total > 0 && withRls === total && withPolicies === total;
  const report = {
    pass: dbEnforced,
    mode: STRICT ? "strict" : "report",
    dbEnforced,
    role: currentRole,
    schema: schema.rows[0] ?? null,
    tables: {
      total,
      rlsEnabled: withRls,
      withPolicies,
      withoutWorkspaceIdColumn: withoutWorkspaceColumn,
    },
    policyCount: policies.rows.length,
    policies: policies.rows,
    applicationScope: {
      note: "Application filtering evidence, not database enforcement.",
      rowsOutsideMychef: crossWorkspace.rows,
    },
    nextStep: dbEnforced
      ? "Database-enforced isolation present. Negative isolation tests can assert refusal."
      : "RLS is not installed. Needs an additive owner-run migration; runtime must never get owner credentials.",
  };

  console.log(JSON.stringify(report, null, 2));

  await appPool.end();
  if (STRICT && !dbEnforced) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await appPool.end().catch(() => undefined);
  process.exit(1);
});
