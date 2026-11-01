/**
 * Who may do what, as pure functions: no database, no request, no environment.
 *
 * Kept out of workspace-access.ts on purpose. An operator row stores its role as free text in the
 * jsonb config column, and a local membership row stores it in a checked column; both are
 * classified here by one list, and the capability rules can be tested without opening a pool.
 *
 * The distinction that matters: a viewer may sign in and read, and may not draft a reply, record a
 * decision, change keys or publish a rule.
 */

export type Role = "owner" | "admin" | "reviewer" | "viewer";

export const ROLES: readonly Role[] = ["owner", "admin", "reviewer", "viewer"];

const ROLE_SET = new Set<string>(ROLES);

/**
 * The role a stored value names, or null when it names none.
 *
 * Never rounds up: an unrecognised value is not a reviewer, which is what the operator path used to
 * do silently, and that is how the shared audit account could write.
 */
export function parseRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ROLE_SET.has(normalized) ? (normalized as Role) : null;
}

/**
 * Resolve a role read from an operator row's jsonb config.
 *
 * An unset or unrecognised value resolves to viewer: the least privilege that can still sign in and
 * read. It never resolves to reviewer, because reviewer can draft and record decisions.
 */
export function operatorRole(value: unknown): Role {
  return parseRole(value) ?? "viewer";
}

/** Draft a reply, accept or reject a candidate, record an outcome. Viewer is read-only. */
export function canReview(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "reviewer";
}

/** Provider keys, autopilot, operator access. */
export function canManageKeys(role: Role): boolean {
  return role === "owner" || role === "admin";
}
