/**
 * Read-only check of the approval-gated retrieval policy against the live database.
 * Purpose: prove no pending, retired, candidate-source or other-project row can be quoted, and that
 * the reviewer explanation counts every row that was withheld.
 * Writes nothing, calls no provider, sends nothing.
 * Run: npm run verify:retrieval   (needs DATABASE_URL for role mychef_runtime)
 */
import { appPool } from "../src/db/client";
import { rankKnowledge } from "../src/data/mychef-store";
import {
  MYCHEF_RETRIEVAL_SCOPE,
  classifyCandidate,
  describeExclusions,
  retrievalNotice,
  type KnowledgeCandidate,
} from "../src/lib/retrieval-policy";

function fail(message: string): never {
  throw new Error(message);
}

async function main() {
  const inbound =
    "Can I get the deposit back? The dinner is in five days. My guest has a severe allergy.";
  const ranked = await rankKnowledge(inbound);

  // Reporting only: what the policy refuses, so a reviewer can see the size of the gap.
  const all = await appPool.query<KnowledgeCandidate>(
    `select id, title, content, status, source, project_id, workspace_id
     from mychef_inbox.knowledge
     where workspace_id = $1`,
    [MYCHEF_RETRIEVAL_SCOPE.workspaceId],
  );
  const refused = all.rows.filter((row) => !classifyCandidate(row, MYCHEF_RETRIEVAL_SCOPE).eligible);

  if (ranked.eligible.some((item) => item.doc.status !== "approved")) {
    fail("an unapproved row reached the eligible set");
  }
  if (ranked.eligible.some((item) => item.doc.project_id !== MYCHEF_RETRIEVAL_SCOPE.projectId)) {
    fail("a row from another project reached the eligible set");
  }
  if (ranked.eligible.some((item) => ["ledger-rule", "learning-pass"].includes(item.doc.source ?? ""))) {
    fail("a candidate source reached the eligible set");
  }
  if (ranked.excluded.total !== refused.length) {
    fail(`exclusion counts (${ranked.excluded.total}) do not match refused rows (${refused.length})`);
  }

  console.log(
    JSON.stringify(
      {
        pass: true,
        policyVersion: ranked.policyVersion,
        scope: ranked.scope,
        rowsInWorkspace: all.rows.length,
        eligible: ranked.eligible.map((item) => ({
          id: item.doc.id,
          title: item.doc.title,
          score: Number(item.score.toFixed(3)),
        })),
        excluded: ranked.excluded,
        exclusionExplanation: describeExclusions(ranked.excluded),
        notice: retrievalNotice(ranked),
        refusedIds: refused.map((row) => row.id),
        refusedStatuses: refused.reduce<Record<string, number>>((acc, row) => {
          const key = `${row.status}/${row.project_id}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2,
    ),
  );
  await appPool.end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await appPool.end().catch(() => undefined);
  process.exit(1);
});
