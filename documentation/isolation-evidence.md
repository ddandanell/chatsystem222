# Database isolation evidence — `mychef_inbox`

Status: measurement tool exists and is read-only; **the database does not enforce isolation yet**.
Owner: MyChef Engineering. Review: MyChef Product & QA.

## The finding this measures

At the 1 November 2026 audit, all **19** tables in `mychef_inbox` had row level security disabled and
had **0** policies. `mychef_runtime` has `USAGE` but not `CREATE` on the schema, and is not superuser
or `BYPASSRLS`. Workspace separation therefore existed only as application filtering in
`src/data/mychef-store.ts` (`where workspace_id = $1`). One missing predicate in one query could leak
another workspace's contacts or conversations.

## How to measure it

```
npm run verify:isolation          # report, exit 0 — safe before the migration
npm run verify:isolation -- --strict   # acceptance gate, exit 1 while isolation is not enforced
```

Both are read-only: catalog queries plus four `count(*)` queries, no writes, no provider calls, no
send. They use `DATABASE_URL` for the **application** role. An owner/migration URL is never read here
and must never be placed in the running app (`MIGRATION_DATABASE_URL` stays a CLI-only variable in
`src/db/migrate.ts` and `src/db/seed.ts`, which no app module imports — asserted by
`tests/isolation-contract.test.ts`).

## Result on 1 November 2026, 11:20 MYT

| Measurement | Value |
|---|---|
| Tables in `mychef_inbox` | 19 |
| RLS enabled | 0 |
| Tables with at least one policy | 0 |
| `mychef_runtime` `rolsuper` / `rolbypassrls` | false / false |
| `mychef_runtime` `CREATE` on schema | false |
| Tables with no `workspace_id` column | `api_usage`, `workspaces` |
| Rows outside workspace `mychef` | 0 in knowledge, conversations, contacts, drafts |

`dbEnforced: false`. `--strict` exits 1. That is the honest current state and the reason the isolation
issue stays a release blocker.

## Acceptance for step C

Step C is done when all of the following are true, and only then:

1. `npm run verify:isolation -- --strict` exits 0 against the live database;
2. every table has a policy bound to the serving role, not `public`, with `USING` and `WITH CHECK`
   for writes where the app writes;
3. child tables without `workspace_id` (`api_usage`, and any future join-only table) are covered by a
   policy that resolves the workspace through its parent, or are shown to be workspace-free by design;
4. negative isolation tests pass: a second workspace's rows are invisible to a query that forgets its
   predicate, and an insert naming another workspace is refused by the database, not by the app;
5. the runtime role is still unable to `CREATE`, `ALTER`, or disable RLS; the owner connection is used
   only by the operator-run migration and is not stored in the app, the repo, or CI.

Items 1–2 need the owner connection (see the step-1 plan, blocker 1). Until it is supplied, the
additive migration and these tests stay unrun and unreported as done.
