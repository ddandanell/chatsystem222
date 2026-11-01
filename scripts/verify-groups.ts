/**
 * Read-only report: how the live knowledge rows file under the seven-group taxonomy.
 * Purpose: show a reviewer what each row maps to, and prove that filing is independent of approval
 * and project scope (the same rows are still refused for retrieval while pending).
 * Writes nothing, calls no provider, sends nothing.
 * Run: npm run verify:groups   (needs DATABASE_URL for role mychef_runtime)
 */
import { appPool } from "../src/db/client";
import { groupForRow, groupLabel } from "../src/lib/knowledge-groups";
import { MYCHEF_RETRIEVAL_SCOPE, classifyCandidate } from "../src/lib/retrieval-policy";

type Row = {
  id: string;
  title: string;
  content: string;
  status: string | null;
  source: string | null;
  project_id: string | null;
  workspace_id: string | null;
  scope: string | null;
};

async function main() {
  const result = await appPool.query<Row>(
    `select id, title, content, status, source, project_id, workspace_id, scope
       from mychef_inbox.knowledge
      where workspace_id = $1
      order by project_id, title`,
    [MYCHEF_RETRIEVAL_SCOPE.workspaceId],
  );

  const byGroup = new Map<string, number>();
  const rows = result.rows.map((row) => {
    const group = groupForRow({ title: row.title, scope: row.scope, project_id: row.project_id });
    byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    const verdict = classifyCandidate(row, MYCHEF_RETRIEVAL_SCOPE);
    return {
      title: row.title.slice(0, 70),
      project: row.project_id,
      status: row.status,
      group,
      readable: groupLabel(row.scope),
      quotable: verdict.eligible,
      refusal: verdict.eligible ? null : verdict.reason,
    };
  });

  console.log(
    JSON.stringify(
      {
        policy: "seven-group taxonomy (reading filter only)",
        rowsInWorkspace: rows.length,
        groups: Object.fromEntries([...byGroup.entries()].sort()),
        quotable: rows.filter((row) => row.quotable).length,
        rows,
      },
      null,
      2,
    ),
  );
  await appPool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
