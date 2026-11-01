/**
 * Knowledge taxonomy for the MyChef console. Do not auto-send.
 *
 * Seven filing groups for private-chef work, plus one explicit `unclassified` state. A row whose
 * scope or title does not match a known group is reported as unclassified — it is never quietly
 * relabelled "bookings" the way the first implementation did. The group is a reading filter; it
 * never changes a row's status, approval or retrieval eligibility.
 */

/** Groups a human may file a position or playbook into. */
export const KNOWLEDGE_GROUPS = [
  { id: "bookings", label: "Bookings" },
  { id: "dietary", label: "Dietary" },
  { id: "pricing", label: "Pricing" },
  { id: "staffing", label: "Staffing" },
  { id: "complaints", label: "Complaints" },
  { id: "tone", label: "Tone" },
  { id: "playbooks", label: "Playbooks" },
] as const;

export type KnowledgeGroup = (typeof KNOWLEDGE_GROUPS)[number]["id"];

/** A row can be read as one of the seven groups, or honestly as unclassified. */
export type KnowledgeGroupFilter = KnowledgeGroup | "unclassified";

/** Filter chips: the seven groups plus the explicit unclassified state. */
export const KNOWLEDGE_FILTER_GROUPS = [
  ...KNOWLEDGE_GROUPS,
  { id: "unclassified", label: "Unclassified" },
] as const;

const GROUP_IDS = new Set<string>(KNOWLEDGE_GROUPS.map((group) => group.id));

/**
 * Legacy scope strings found in imported and hand-written rows. `tone` used to fall into
 * `staffing`; it is its own group now. Unknown scopes deliberately have no entry.
 */
const SCOPE_TO_GROUP: Record<string, KnowledgeGroup> = {
  booking: "bookings",
  bookings: "bookings",
  reservation: "bookings",
  reservations: "bookings",
  billing: "pricing",
  pricing: "pricing",
  pricing_and_menus: "pricing",
  menu: "pricing",
  service: "dietary",
  dietary: "dietary",
  allergies: "dietary",
  operations: "staffing",
  staffing: "staffing",
  complaints: "complaints",
  complaint: "complaints",
  tone: "tone",
  voice: "tone",
  tone_and_voice: "tone",
  playbook: "playbooks",
  playbooks: "playbooks",
  procedures: "playbooks",
};

export function isKnowledgeGroup(value: string): value is KnowledgeGroup {
  return GROUP_IDS.has(value);
}

export function isKnowledgeGroupFilter(value: string): value is KnowledgeGroupFilter {
  return isKnowledgeGroup(value) || value === "unclassified";
}

export function groupForScope(scope: string | null | undefined): KnowledgeGroupFilter {
  const key = (scope ?? "").trim().toLowerCase();
  if (!key) return "unclassified";
  return SCOPE_TO_GROUP[key] ?? "unclassified";
}

export function groupLabel(scope: string | null | undefined): string {
  const id = groupForScope(scope);
  const found = KNOWLEDGE_FILTER_GROUPS.find((group) => group.id === id);
  return found?.label ?? "Unclassified";
}

/**
 * File a stored row. Rows that belong to another project are reported as unclassified: a note
 * titled "Cooking class pricing" is that project's context, not MyChef pricing guidance, so the
 * title heuristic is not allowed to file it here. Rows with no project (or a global marker) may be
 * filed normally, because approved global knowledge is quotable in this project.
 */
export function groupForRow(
  row: { title: string; scope?: string | null; project_id?: string | null },
  currentProjectId = "mychef",
): KnowledgeGroupFilter {
  const project = (row.project_id ?? "").trim().toLowerCase();
  const isGlobal = project === "" || project === "global" || project === "workspace";
  if (!isGlobal && project !== currentProjectId.trim().toLowerCase()) return "unclassified";
  return groupForTitle(row.title, row.scope);
}

/**
 * Title-only fallback for rows without a usable scope. Ordered: the first match wins, and a title
 * that matches nothing stays unclassified rather than defaulting into a group.
 */
export function groupForTitle(title: string, scope?: string | null): KnowledgeGroupFilter {
  const byScope = groupForScope(scope);
  if (byScope !== "unclassified") return byScope;
  const text = title.toLowerCase();
  if (/tone|voice|wording|phras/.test(text)) return "tone";
  if (/playbook|procedure|checklist|quick.?start|template|script|prompt|readme|master/.test(text))
    return "playbooks";
  if (/pric|billing|invoice|deposit|menu|cost/.test(text)) return "pricing";
  if (/diet|allerg|vegan|halal|cross.?contamin/.test(text)) return "dietary";
  if (/staff|hiring|shift|roster|team/.test(text)) return "staffing";
  if (/complain|refund|angry|escalat|apolog/.test(text)) return "complaints";
  if (/book|reserv|calendar|cancel|guest/.test(text)) return "bookings";
  return "unclassified";
}
