/**
 * Membership check. Neon allows only an approved operator. Do not auto-send.
 */
import { and, eq, sql } from "drizzle-orm";
import { appDb } from "@/db/client";
import { usesMychefInbox } from "@/db/mode";
import { findOperator } from "@/lib/operators";
import { canManageKeys, canReview, parseRole, type Role } from "@/lib/roles";
import { memberships, organizations, users } from "@/db/schema";

// The role type and the capability rules live in roles.ts so they can be tested without a pool.
// Re-exported here because every call site already imports them from this module.
export { canManageKeys, canReview };
export type { Role };

export type WorkspaceContext = {
  userId: string;
  orgId: string;
  role: Role;
  orgSlug: string;
  orgName: string;
  email: string;
  name: string | null;
};

export type WorkspaceAccess =
  | { status: "ok"; ctx: WorkspaceContext }
  | { status: "unknown" }
  | { status: "forbidden"; orgName: string; orgSlug: string };

function asRole(value: string): Role {
  const role = parseRole(value);
  // A membership row's role is checked by the local schema, so an unknown one is a data fault and
  // must fail loudly rather than quietly become a role with different powers.
  if (!role) throw new Error(`unexpected role ${value}`);
  return role;
}

export async function findOrCreateUser(email: string, name: string | null) {
  const normalized = email.trim().toLowerCase();
  const existing = await appDb
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await appDb
    .insert(users)
    .values({ email: normalized, name })
    .returning();
  return inserted[0];
}

export async function authorizeWorkspace(
  userId: string,
  slug: string,
  profile?: { email?: string | null; name?: string | null },
): Promise<WorkspaceAccess> {
  if (usesMychefInbox()) {
    if (slug !== "mychef") return { status: "unknown" };
    const operator = await findOperator(profile?.email ?? "");
    if (!operator?.approved) {
      return { status: "forbidden", orgName: "myCHEF", orgSlug: "mychef" };
    }
    return {
      status: "ok",
      ctx: {
        userId,
        orgId: "mychef",
        role: operator.role,
        orgSlug: "mychef",
        orgName: "myCHEF",
        email: operator.email,
        name: operator.name,
      },
    };
  }
  const orgRows = await appDb
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  const org = orgRows[0];
  if (!org) return { status: "unknown" };

  const memberRows = await appDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, userId)))
    .limit(1);
  const member = memberRows[0];
  if (!member) {
    return { status: "forbidden", orgName: org.name, orgSlug: org.slug };
  }

  const userRows = await appDb
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];

  return {
    status: "ok",
    ctx: {
      userId,
      orgId: org.id,
      role: asRole(member.role),
      orgSlug: org.slug,
      orgName: org.name,
      email: user?.email ?? "",
      name: user?.name ?? null,
    },
  };
}

export async function listMyWorkspaces(userId: string) {
  if (usesMychefInbox()) {
    return [{ slug: "mychef", name: "myCHEF", role: "owner" }];
  }
  const rows = await appDb
    .select({
      slug: organizations.slug,
      name: organizations.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.name);
  return rows;
}
