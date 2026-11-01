/**
 * The single knowledge read used by every path that quotes a source. Do not auto-send.
 *
 * Before this module there were two retrieval paths: the interactive draft went through the
 * approval-gated query and `rankKnowledgeRows()`, while the GHL webhook selected rows by
 * `workspace_id` alone and took the first eight. On the live database that webhook query returned
 * 12 rows: 12 unapproved and 4 belonging to another project. A reviewer opening the automated draft
 * could therefore read pending and foreign text that the interactive draft correctly refused.
 *
 * Both paths now call this function, so the policy has one implementation and one place to test.
 * The SQL gate is the first line of defence; `rankKnowledgeRows()` re-checks every row, which is why
 * a caller that is handed unfiltered rows still cannot get a pending or foreign source into a draft.
 */
import type { Pool, PoolClient } from "pg";
import {
  KNOWLEDGE_COUNTS_SQL,
  KNOWLEDGE_RETRIEVAL_SQL,
  MYCHEF_RETRIEVAL_SCOPE,
  rankKnowledgeRows,
  summarizeExcludedGroups,
  type KnowledgeCandidate,
  type KnowledgeCountGroup,
  type RankedResult,
  type RetrievalScope,
} from "@/lib/retrieval-policy";

/** A pool or a client inside a transaction: the webhook must read inside its own transaction. */
export type KnowledgeDb = Pool | PoolClient;

/**
 * Approved, in-project knowledge, ranked against the inbound text, plus the counts of what was
 * withheld. Exclusion counts come from a grouped metadata query so pending bodies are never loaded
 * merely to explain a refusal.
 */
export async function rankKnowledgeFromDatabase(
  db: KnowledgeDb,
  inbound: string,
  tagHint = "",
  scope: RetrievalScope = MYCHEF_RETRIEVAL_SCOPE,
): Promise<RankedResult> {
  const [docs, groups] = await Promise.all([
    db.query<KnowledgeCandidate>(KNOWLEDGE_RETRIEVAL_SQL, [scope.workspaceId]),
    db.query<KnowledgeCountGroup>(KNOWLEDGE_COUNTS_SQL, [scope.workspaceId]),
  ]);
  const ranked = rankKnowledgeRows(docs.rows, inbound, tagHint, scope);
  return { ...ranked, excluded: summarizeExcludedGroups(groups.rows, scope) };
}
