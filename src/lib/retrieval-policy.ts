/**
 * Retrieval policy for authoritative knowledge. Do not auto-send.
 *
 * Purpose: decide which knowledge rows may be quoted in a MyChef draft. Approval is the gate;
 * project scope is a boundary, not a similarity bonus. Anything unknown fails closed.
 * Tables: mychef_inbox.knowledge (read only; no writes here).
 * Specs: documentation/agent-spec.md, documentation/todo.md ("do not trust a workspace id sent
 * by the browser", knowledge must be published before it is policy).
 */
import { tokenize } from "@/lib/embed";

/**
 * Bump whenever the eligibility rules below change. The version is stored with every draft so a
 * reviewer can tell which rules produced the sources they are looking at.
 */
export const RETRIEVAL_POLICY_VERSION = "approval-gated-project-v1";

/** Candidate/learning sources are never quoted, even if their status says approved. */
export const CANDIDATE_SOURCES = ["ledger-rule", "learning-pass", "menu"] as const;

/**
 * Grouped counts used to explain a draft that quoted nothing. Only the fields the policy reads are
 * selected, so pending content is never loaded to produce a review explanation.
 */
export const KNOWLEDGE_COUNTS_SQL = `select status, source, project_id, workspace_id, count(*)::int as n
     from mychef_inbox.knowledge
     where workspace_id = $1
     group by 1, 2, 3, 4`;

/** Project ids that mean "every project in this workspace". */
export const GLOBAL_PROJECT_IDS = ["", "global", "workspace"] as const;

/**
 * The SQL gate applied before ranking. Approval and workspace are enforced in the query; the
 * candidate-source denylist is repeated with coalesce() because `not in (...)` drops NULL sources.
 * Tests assert this string keeps both the workspace parameter and the approval predicate.
 */
export const KNOWLEDGE_RETRIEVAL_SQL = `select id, title, content, status, source, project_id, workspace_id
     from mychef_inbox.knowledge
     where workspace_id = $1
       and status = 'approved'
       and coalesce(source, '') not in ('ledger-rule', 'learning-pass', 'menu')
     order by title`;

export type KnowledgeCandidate = {
  id: string;
  title: string;
  content: string;
  status: string | null;
  source: string | null;
  project_id: string | null;
  workspace_id?: string | null;
};

export type RetrievalScope = {
  workspaceId: string;
  projectId: string;
  /** Approved rows with no project (or a global marker) may be quoted in this project. */
  allowApprovedGlobal: boolean;
};

export const MYCHEF_RETRIEVAL_SCOPE: RetrievalScope = {
  workspaceId: "mychef",
  projectId: "mychef",
  allowApprovedGlobal: true,
};

export type ExclusionReason =
  | "other_workspace"
  | "candidate_source"
  | "not_approved"
  | "retired"
  | "other_project";

export type ExclusionSummary = {
  other_workspace: number;
  candidate_source: number;
  not_approved: number;
  retired: number;
  other_project: number;
  total: number;
};

export type RankedKnowledge = {
  doc: KnowledgeCandidate;
  score: number;
  kind: "position" | "playbook";
};

export type RankedResult = {
  policyVersion: string;
  scope: RetrievalScope;
  eligible: RankedKnowledge[];
  excluded: ExclusionSummary;
};

export function emptyExclusionSummary(): ExclusionSummary {
  return {
    other_workspace: 0,
    candidate_source: 0,
    not_approved: 0,
    retired: 0,
    other_project: 0,
    total: 0,
  };
}

export type KnowledgeCountGroup = {
  status: string | null;
  source: string | null;
  project_id: string | null;
  workspace_id: string | null;
  n: number | string;
};

/**
 * Turn grouped counts into exclusion totals. Eligible groups contribute nothing, so the sum of the
 * reasons is exactly the number of rows a reviewer was not shown.
 */
export function summarizeExcludedGroups(
  groups: KnowledgeCountGroup[],
  scope: RetrievalScope = MYCHEF_RETRIEVAL_SCOPE,
): ExclusionSummary {
  const summary = emptyExclusionSummary();
  for (const group of groups) {
    const count = Number(group.n) || 0;
    if (count <= 0) continue;
    const verdict = classifyCandidate(
      {
        id: "group",
        title: "",
        content: "",
        status: group.status,
        source: group.source,
        project_id: group.project_id,
        workspace_id: group.workspace_id,
      },
      scope,
    );
    if (verdict.eligible) continue;
    summary[verdict.reason] += count;
    summary.total += count;
  }
  return summary;
}

export function kindForTitle(title: string): "position" | "playbook" {
  return /TEMPLATE|TONE|QUICK_START|SYSTEM_PROMPT|README/i.test(title) ? "playbook" : "position";
}

function isGlobalProject(projectId: string | null): boolean {
  if (projectId == null) return true;
  const normalized = projectId.trim().toLowerCase();
  return (GLOBAL_PROJECT_IDS as readonly string[]).includes(normalized);
}

/**
 * Order matters: workspace and candidate sources are structural, so they are reported first;
 * then approval; then project scope. Every branch that is not explicitly allowed is a refusal.
 */
export function classifyCandidate(
  row: KnowledgeCandidate,
  scope: RetrievalScope = MYCHEF_RETRIEVAL_SCOPE,
): { eligible: true } | { eligible: false; reason: ExclusionReason } {
  if (row.workspace_id != null && row.workspace_id !== scope.workspaceId) {
    return { eligible: false, reason: "other_workspace" };
  }
  const source = (row.source ?? "").trim().toLowerCase();
  if ((CANDIDATE_SOURCES as readonly string[]).includes(source)) {
    return { eligible: false, reason: "candidate_source" };
  }
  const status = (row.status ?? "").trim().toLowerCase();
  if (status === "retired") return { eligible: false, reason: "retired" };
  if (status !== "approved") return { eligible: false, reason: "not_approved" };
  if (row.project_id === scope.projectId) return { eligible: true };
  if (isGlobalProject(row.project_id) && scope.allowApprovedGlobal) return { eligible: true };
  return { eligible: false, reason: "other_project" };
}

function lexicalScore(queryText: string, title: string, body: string): number {
  const tokens = new Set(tokenize(queryText));
  if (tokens.size === 0) return 0;
  let hits = 0;
  const seen = new Set<string>();
  for (const token of tokenize(`${title}\n${body}`)) {
    if (seen.has(token) || !tokens.has(token)) continue;
    seen.add(token);
    hits += token.length > 4 && title.toLowerCase().includes(token) ? 3 : 1;
  }
  return hits / tokens.size;
}

/**
 * Score approved, in-scope rows only. The project id is deliberately absent from the haystack:
 * scope is decided before ranking, so an unrelated project can never outrank the right one.
 */
export function rankKnowledgeRows(
  rows: KnowledgeCandidate[],
  inbound: string,
  tagHint = "",
  scope: RetrievalScope = MYCHEF_RETRIEVAL_SCOPE,
): RankedResult {
  const excluded = emptyExclusionSummary();
  const eligible: RankedKnowledge[] = [];
  const hint = tagHint.toLowerCase().trim();

  for (const row of rows) {
    const verdict = classifyCandidate(row, scope);
    if (!verdict.eligible) {
      excluded[verdict.reason] += 1;
      excluded.total += 1;
      continue;
    }
    let score = lexicalScore(inbound, row.title, row.content);
    if (hint) {
      const hay = `${row.title} ${row.content.slice(0, 400)}`.toLowerCase();
      if (hint.split(/\s+/).some((token) => token.length > 2 && hay.includes(token))) {
        score += 0.35;
      }
    }
    if ((row.source ?? "").trim().toLowerCase() === "situational") score += 0.15;
    eligible.push({ doc: row, score, kind: kindForTitle(row.title) });
  }

  eligible.sort((left, right) => right.score - left.score);
  return { policyVersion: RETRIEVAL_POLICY_VERSION, scope, eligible, excluded };
}

const EXCLUSION_LABELS: { key: Exclude<keyof ExclusionSummary, "total">; label: string }[] = [
  { key: "not_approved", label: "awaiting approval" },
  { key: "other_project", label: "for another project" },
  { key: "retired", label: "retired" },
  { key: "candidate_source", label: "candidate rules" },
  { key: "other_workspace", label: "another workspace" },
];

export function describeExclusions(excluded: ExclusionSummary): string {
  const parts = EXCLUSION_LABELS.filter(({ key }) => excluded[key] > 0).map(
    ({ key, label }) => `${excluded[key]} ${label}`,
  );
  return parts.length === 0 ? "none excluded" : parts.join(", ");
}

/**
 * Plain-language explanation for a reviewer whose draft has no quoted knowledge. Returns null
 * when at least one approved row was available, so the drafter's own wording is kept.
 */
export function retrievalNotice(result: RankedResult): string | null {
  if (result.eligible.length > 0) return null;
  const scope = result.scope;
  return `No approved knowledge for project “${scope.projectId}” could be quoted (${describeExclusions(result.excluded)}). Nothing was retrieved, so a person should answer.`;
}
