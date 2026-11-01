/**
 * Two places where a role was assumed rather than read, closed after review (QA residuals A and B
 * inside PR 19).
 *
 * A. saveOperatorAction defaulted a missing `role` form field to "reviewer". A form that sends no
 *    role is a caller that did not state one, and the least privilege that can still sign in is
 *    viewer. The positive control re-runs the same form with role=admin, so the assertion is about
 *    the default and not about a broken mock.
 *
 * B. listMyWorkspaces returned a hardcoded "owner" for the Neon workspace. Every session read it —
 *    the first-workspace screen printed "myCHEF · owner", and the workspace switcher did the same
 *    — while authorizeWorkspace resolved the real role separately. Both now come from one row.
 *
 * No database, no network: the pool, the operator table and the session are replaced at the module
 * boundary. Nothing here can write to Neon.
 */

import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Role = "owner" | "admin" | "reviewer" | "viewer";
type SavedOperator = { email: string; name: string; password: string; role: Role; approved: boolean };

const state: {
  accessRole: Role;
  operator: { role: Role } | null;
  saved: SavedOperator[];
  redirects: string[];
} = { accessRole: "owner", operator: { role: "viewer" }, saved: [], redirects: [] };

mock.module("@/lib/context", {
  namedExports: {
    getWorkspaceAccess: async () => ({
      status: "ok",
      ctx: {
        orgId: "mychef",
        orgSlug: "mychef",
        userId: "user-1",
        email: "operator@mychef.id",
        name: "Operator",
        role: state.accessRole,
      },
    }),
  },
});

mock.module("@/lib/operators", {
  namedExports: {
    saveOperator: async (input: SavedOperator) => {
      state.saved.push(input);
      return { ok: true };
    },
    findOperator: async () => state.operator,
  },
});

mock.module("@/db/mode", {
  namedExports: { usesMychefInbox: () => true, userIdFromEmail: () => "user-1" },
});

mock.module("@/db/client", {
  namedExports: {
    appDb: {},
    appPool: { query: async () => ({ rows: [] }) },
  },
});

mock.module("next/cache", {
  namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
});

mock.module("next/navigation", {
  namedExports: {
    redirect: (url: string) => {
      state.redirects.push(String(url));
      const error = new Error(`redirect:${url}`);
      (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
      throw error;
    },
  },
});

type Actions = {
  saveOperatorAction: (slug: string, formData: FormData) => Promise<unknown>;
};
type Access = {
  listMyWorkspaces: (
    userId: string,
    email?: string | null,
  ) => Promise<{ slug: string; name: string; role: Role }[]>;
};

let actions: Actions;
let access: Access;

before(async () => {
  actions = (await import("@/app/[workspace]/settings/access/actions")) as unknown as Actions;
  access = (await import("@/lib/workspace-access")) as unknown as Access;
});

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function save(values: Record<string, string>) {
  state.saved = [];
  state.redirects = [];
  try {
    await actions.saveOperatorAction("mychef", form(values));
  } catch (error) {
    const digest = (error as Error & { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
  }
  return { saved: [...state.saved], redirects: [...state.redirects] };
}

const newOperator = {
  email: "new@mychef.id",
  name: "New Operator",
  password: "x".repeat(24),
  approved: "on",
};

test("a form that sends no role field saves a viewer, not a reviewer", async () => {
  state.accessRole = "owner";
  const { saved } = await save(newOperator);
  assert.equal(saved.length, 1, "the owner's form must still reach saveOperator");
  assert.equal(saved[0].role, "viewer", "an omitted role must not mint a reviewer");
});

test("the same form with role=admin saves an admin, so the default above is the gate", async () => {
  state.accessRole = "owner";
  const { saved } = await save({ ...newOperator, role: "admin" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].role, "admin", "a stated role must be honoured unchanged");
});

test("a stated viewer is stored as a viewer, not rounded up on the way in", async () => {
  state.accessRole = "owner";
  const { saved } = await save({ ...newOperator, role: "viewer" });
  assert.equal(saved[0].role, "viewer");
});

test("a viewer still cannot reach saveOperator, so the default cannot be used to escalate", async () => {
  state.accessRole = "viewer";
  const { saved, redirects } = await save({ ...newOperator, role: "owner" });
  assert.deepEqual(saved, [], "a viewer must not save an operator at all");
  assert.equal(redirects.length, 1);
  assert.match(redirects[0], /error=You\+cannot\+change\+access/);
});

test("the workspace list reports the signed-in operator's own role", async () => {
  state.operator = { role: "viewer" };
  assert.deepEqual(await access.listMyWorkspaces("user-1", "v@mychef.id"), [
    { slug: "mychef", name: "myCHEF", role: "viewer" },
  ]);

  state.operator = { role: "owner" };
  const owner = await access.listMyWorkspaces("user-1", "o@mychef.id");
  assert.equal(owner[0].role, "owner");

  state.operator = { role: "reviewer" };
  const reviewer = await access.listMyWorkspaces("user-1", "r@mychef.id");
  assert.equal(reviewer[0].role, "reviewer", "a reviewer must not be shown as the owner");
});

test("with no operator row the list says viewer, never owner", async () => {
  state.operator = null;
  const rows = await access.listMyWorkspaces("user-1", "unknown@example.com");
  assert.equal(rows[0].role, "viewer", "an unknown identity must not be handed the owner label");
});

test("the source has no hardcoded owner left in the workspace list", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/workspace-access.ts"), "utf8");
  assert.doesNotMatch(source, /role:\s*"owner"/, "listMyWorkspaces must not assume a role");
  assert.match(source, /findOperator\(/, "the list must read the operator row");
});

test("every listMyWorkspaces call site passes the signed-in email", () => {
  const callSites = ["src/app/page.tsx", "src/app/onboarding/page.tsx", "src/app/[workspace]/layout.tsx"];
  for (const file of callSites) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /listMyWorkspaces\([^)]*,[^)]*\)/,
      `${file} must pass an identity, not just a user id`,
    );
  }
});
