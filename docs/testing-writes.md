# Testing anything that writes

**Rule: a test that writes runs inside `BEGIN … ROLLBACK`, or on a scratch database. There is no third option.**

## Why this exists

`mychef_runtime` cannot clean up after a test. Measured on the production database (2026-11-01):

| table | SELECT | INSERT | UPDATE | DELETE | TRUNCATE |
| --- | --- | --- | --- | --- | --- |
| `mychef_inbox.integration_connections` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `mychef_inbox.audit_log` | ✓ | ✓ | ✓ | ✗ | ✗ |

Two artefacts written outside a transaction on 2026-11-01 could therefore not be deleted by any
operator, and had to be quarantined with corrective rows instead. A dangling row is not a small
cost: it changes what the console shows a real user.

A scratch database would be the cleaner answer and it is not available: the runtime role has no
`CREATE` on schema `mychef_inbox`, so a test schema cannot be built with our credential. The wrapper
is the shape that works with what we have.

## How

`npm run verify:rollback` proves the wrapper on whatever `DATABASE_URL` points at:

1. `BEGIN`
2. insert one `audit_log` probe row
3. the row is visible on the inserting connection — `count = 1`
4. a **second** connection does not see it — `count = 0`. That is isolation, not just rollback.
5. `ROLLBACK`
6. the probe row is gone and the table's row count is exactly what it was before

Exit 0 means: a write test here leaves no row behind. Run it once against the target database before
you run any write test against that database.

```bash
npm run verify:rollback                     # local Docker Postgres from .env.local
# or, against the live database, with DATABASE_URL supplied in-process by a launcher that does
# not put the password on disk
```

## Writing the test itself

```ts
const client = await appPool.connect();
try {
  await client.query("begin");
  // … the write under test, on this client …
  await client.query("rollback");   // or assert, then rollback
} finally {
  client.release();
}
```

- Use **one** client for the whole test. A `pool.query()` between `BEGIN` and `ROLLBACK` may run on a
  different connection and land outside the transaction, permanent and undeletable.
- Never `COMMIT` in a test. If a test needs a committed row to be meaningful, it is an acceptance
  test and needs David's approval and an owner-run cleanup plan.
- `DELETE` is not available to us. Any cleanup step that assumes it is a bug in the test.
- Assert on the row **inside** the transaction, then assert its absence after the rollback. Both
  halves matter: the first catches a test that writes nothing, the second catches one that leaks.
