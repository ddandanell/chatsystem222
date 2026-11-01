/**
 * Prove that a write-test against the live database leaves no trace.
 *
 * The blocker: four test items (MC-050/051/052/060) write drafts and decisions, and nobody tests
 * those against production. We cannot get a scratch database — `mychef_runtime` has no CREATE on the
 * schema, and it has DELETE=false on `integration_connections` and `audit_log`, so a test artefact
 * written outside a transaction cannot be removed by anyone. Wrapping the write is the only safe
 * shape available to us, so this script proves the wrapper on the real database with the real role.
 *
 * What it does: BEGIN, insert one audit row, confirm it is visible inside the transaction and
 * invisible to a second connection, ROLLBACK, then confirm the row count is exactly what it was.
 * Nothing is committed, nothing is sent, and no existing row is read or modified.
 *
 * Run: npm run verify:rollback        (needs DATABASE_URL for an application role)
 * Exit 0 only when all four assertions hold.
 */
import type { PoolClient } from "pg";
import { appPool } from "../src/db/client";

const WORKSPACE = "mychef";
const MARKER = `verify-rollback:${new Date().toISOString()}:${process.pid}`;

async function totalRows(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from mychef_inbox.audit_log where workspace_id = $1`,
    [WORKSPACE],
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function probeRows(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from mychef_inbox.audit_log where record_id = $1`,
    [MARKER],
  );
  return Number(result.rows[0]?.count ?? "0");
}

function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
  return ok;
}

async function main() {
  const who = await appPool.query<{ current_user: string; host: string }>(
    `select current_user, coalesce(inet_server_addr()::text, 'local') as host`,
  );
  console.log(`target role=${who.rows[0]?.current_user} host=${who.rows[0]?.host} marker=${MARKER}`);

  const client = await appPool.connect();
  let ok = true;
  try {
    const before = await totalRows(client);

    await client.query("begin");
    await client.query(
      `insert into mychef_inbox.audit_log (workspace_id, actor_id, action, record_id)
       values ($1, $2, 'verify.rollback.probe', $3)`,
      [WORKSPACE, "verify-rollback", MARKER],
    );
    const inside = await probeRows(client);
    ok = check("the probe row is visible inside its own transaction", inside === 1, `count=${inside}`) && ok;

    // A second connection must not see an uncommitted row: that is isolation, not just rollback.
    const other = await appPool.query<{ count: string }>(
      `select count(*)::text as count from mychef_inbox.audit_log where record_id = $1`,
      [MARKER],
    );
    const outside = Number(other.rows[0]?.count ?? "0");
    ok = check("no other connection can see it", outside === 0, `count=${outside}`) && ok;

    await client.query("rollback");

    const after = await probeRows(client);
    ok = check("the row is gone after ROLLBACK", after === 0, `count=${after}`) && ok;

    const total = await totalRows(client);
    ok = check("the table holds the same number of rows as before", before === total, `before=${before} after=${total}`) && ok;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await appPool.end();
  if (!ok) {
    console.error("write tests are NOT safe against this database with this wrapper");
    process.exit(1);
  }
  console.log("BEGIN/ROLLBACK wrapper holds: a write test here leaves no row behind");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
