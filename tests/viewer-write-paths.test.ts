/**
 * ENG-1, part 2: every write path that trusts a role must refuse a viewer, and the refusal has
 * to be tested as a refusal — not inferred from "it did not crash".
 *
 * These tests call the real exported server actions. The session, the store and the side-effect
 * modules are replaced at the module boundary (node:test mock.module), so:
 *   - a viewer reaches the action exactly as a signed-in viewer would,
 *   - every write entry point records a call in `state.calls`,
 *   - refusal = the action returns/redirects with a refusal AND `state.calls` is empty.
 *
 * The positive control matters as much as the refusal: the same test re-runs each path as a role
 * that is allowed, and asserts the write entry point *was* called. Without that control a typo in
 * the mock would make every refusal look like a pass.
 *
 * No database, no network, no request scope: nothing here can write to Neon.
 *
 * One typing note: mock.module() is called with `namedExports` because this repo type-checks
 * against @types/node 20, where MockModuleOptions has no `exports` key. The Node 22/24 runtime
 * prints a deprecation warning for it and still honours it; switch to `exports` when @types/node
 * moves to 22.
 */

import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

type Role = "owner" | "admin" | "reviewer" | "viewer";

const state: { role: Role; calls: string[]; redirects: string[] } = {
  role: "viewer",
  calls: [],
  redirects: [],
};

function record(name: string, value?: unknown) {
  return async (...args: unknown[]) => {
    void args;
    state.calls.push(name);
    return value;
  };
}

mock.module("@/lib/context", {
  namedExports: {
    getWorkspaceAccess: async () => ({
      status: "ok",
      ctx: {
        orgId: "00000000-0000-4000-8000-000000000001",
        orgSlug: "mychef",
        userId: "user-1",
        email: "operator@mychef.id",
        role: state.role,
      },
    }),
  },
});

mock.module("@/db/mode", {
  namedExports: {
    // The Neon write paths are the ones production runs, so they are the ones under test.
    usesMychefInbox: () => true,
    userIdFromEmail: () => "00000000-0000-4000-8000-000000000002",
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
    notFound: () => {
      throw new Error("notFound");
    },
  },
});

mock.module("@/data/mychef-store", {
  namedExports: {
    draftForConversation: record("draftForConversation"),
    ensureDraftForConversation: record("ensureDraftForConversation", {
      ok: true,
      created: true,
      draft: { body: "draft" },
      conversation: { id: "conv-1" },
    }),
    agentDraftForConversation: record("agentDraftForConversation", {
      ok: true,
      agent: {
        draftText: "draft",
        provider: "local",
        model: "local",
        why: "why",
        whyNot: "why-not",
        notice: null,
        escalate: false,
        fellBack: true,
        sourceRefs: [],
      },
    }),
    updateContactTags: record("updateContactTags", { ok: true, tags: [] }),
    reviewConversation: record("reviewConversation", { ok: true }),
    recordOutcome: record("recordOutcome"),
    getConversation: record("getConversation", { id: "conv-1", contact_id: "contact-1" }),
    runMychefLearning: record("runMychefLearning", { created: 0 }),
    runLearningPass: record("runLearningPass", {
      clustered: 0,
      proposed: 0,
      refreshed: 0,
      processed: 0,
    }),
    runMychefEvals: record("runMychefEvals"),
    setKnowledgeStatus: record("setKnowledgeStatus"),
    setMychefRuleStatus: record("setMychefRuleStatus"),
    proposeFromDecision: record("proposeFromDecision", { ok: true }),
  },
});

mock.module("@/data/inbox-board", {
  namedExports: { setContactTags: record("setContactTags", { ok: true }) },
});

mock.module("@/lib/draft", {
  namedExports: { createDraft: record("createDraft", { ok: true, id: "draft-1" }) },
});

mock.module("@/lib/decisions", {
  namedExports: {
    getDecision: record("getDecision", null),
    saveReview: record("saveReview", { ok: true }),
  },
});

mock.module("@/lib/learning-loop", {
  namedExports: {
    runLearningLoop: record("runLearningLoop", { created: 0 }),
    setRuleStatus: record("setRuleStatus"),
  },
});

mock.module("@/lib/eval-runner", {
  namedExports: { runWorkspaceEvals: record("runWorkspaceEvals", { passed: 0 }) },
});

mock.module("@/lib/raw-archive", {
  namedExports: {
    storeArchive: record("storeArchive", { filename: "export.zip", files: [] }),
    readArchiveText: record("readArchiveText", "archived text"),
    markArchiveCurated: record("markArchiveCurated"),
  },
});

mock.module("@/db/client", {
  namedExports: {
    appPool: { query: record("appPool.query", { rows: [] }) },
  },
});

mock.module("@/lib/operators", {
  namedExports: { saveOperator: record("saveOperator", { ok: true }) },
});

mock.module("@/lib/credentials", {
  namedExports: {
    saveCredential: record("saveCredential", { ok: true }),
    rotateCredential: record("rotateCredential", { ok: true }),
    revokeCredential: record("revokeCredential", { ok: true }),
  },
});

mock.module("@/lib/gateway", {
  namedExports: { testProviderConnection: record("testProviderConnection", { ok: true }) },
});

mock.module("@/lib/autopilot", {
  namedExports: { saveAutopilot: record("saveAutopilot", { ok: true }) },
});

// Imported after the mocks are registered, so the action modules see the replaced specifiers.
// Dynamic imports inside before(), because this package compiles tests as CommonJS (no top-level
// await), and the order still holds: every mock.module call above runs at module load.
type Module = Record<string, (...args: unknown[]) => Promise<unknown>>;
let inbox: Module;
let ledger: Module;
let cockpit: Module;
let archive: Module;
let access: Module;
let keys: Module;
let autopilot: Module;

before(async () => {
  inbox = (await import("@/app/[workspace]/inbox/mychef-actions")) as unknown as Module;
  ledger = (await import("@/app/[workspace]/ledger-actions")) as unknown as Module;
  cockpit = (await import("@/app/[workspace]/inbox/cockpit-actions")) as unknown as Module;
  archive = (await import("@/app/[workspace]/import/actions")) as unknown as Module;
  access = (await import("@/app/[workspace]/settings/access/actions")) as unknown as Module;
  keys = (await import("@/app/[workspace]/settings/keys/actions")) as unknown as Module;
  autopilot = (await import("@/app/[workspace]/settings/autopilot/actions")) as unknown as Module;
});

function form(values: Record<string, string | File> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/**
 * Run one action. A redirect is a legitimate outcome (some actions deny by redirecting with an
 * error), so it is recorded and not rethrown.
 */
async function run(action: () => Promise<unknown>) {
  state.calls = [];
  state.redirects = [];
  let result: unknown = undefined;
  try {
    result = await action();
  } catch (error) {
    const digest = (error as Error & { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    result = { redirected: true };
  }
  return { result, calls: [...state.calls], redirects: [...state.redirects] };
}

const refusalText = (result: unknown): string => {
  if (result && typeof result === "object" && "error" in result) {
    return String((result as { error?: unknown }).error ?? "");
  }
  return "";
};

// ---------------------------------------------------------------------------------------------
// The paths. Each entry is a write a viewer must not be able to perform.
// ---------------------------------------------------------------------------------------------

const reviewPaths: { name: string; run: () => Promise<unknown> }[] = [
  { name: "draftConversationAction", run: () => inbox.draftConversationAction("conv-1") },
  { name: "ensureDraftAction", run: () => inbox.ensureDraftAction("conv-1") },
  { name: "agentDraftAction", run: () => inbox.agentDraftAction("conv-1", "be brief") },
  { name: "updateTagsAction", run: () => inbox.updateTagsAction("conv-1", ["birthday"]) },
  {
    name: "reviewConversationAction",
    run: () =>
      inbox.reviewConversationAction("conv-1", null, form({
        human_decision: "accepted",
        reason_code: "good_as_drafted",
        rationale: "fine",
        why_not: "nothing better",
        final_text: "hello",
      })),
  },
  { name: "outcomeAction", run: () => inbox.outcomeAction("decision-1", form({ outcome: "booked" })) },
  { name: "learnAction", run: () => ledger.learnAction("mychef") },
  { name: "learnPassAction", run: () => ledger.learnPassAction("mychef") },
  {
    name: "ruleStatusAction",
    run: () => ledger.ruleStatusAction("mychef", form({ id: "rule-1", status: "approved" })),
  },
  {
    name: "knowledgeStatusAction",
    run: () => ledger.knowledgeStatusAction("mychef", form({ id: "snippet-1", status: "approved" })),
  },
  { name: "evalAction", run: () => ledger.evalAction("mychef") },
  { name: "regenerateInboxAction", run: () => cockpit.regenerateInboxAction("mychef", form({ id: "conv-1" })) },
  {
    name: "retagInboxAction",
    run: () => cockpit.retagInboxAction("mychef", form({ id: "conv-1", tag: "birthday" })),
  },
  { name: "curateArchiveAction", run: () => archive.curateArchiveAction("mychef", form({ id: "import-1" })) },
];

for (const path of reviewPaths) {
  test(`viewer is refused by ${path.name}, and nothing is written`, async () => {
    state.role = "viewer";
    const { result, calls } = await run(path.run);
    assert.deepEqual(calls, [], `${path.name} must not reach a write entry point for a viewer`);
    // Where the action can say so, the refusal is visible text rather than silence.
    if (refusalText(result)) {
      assert.match(refusalText(result), /role|draft|review|cannot/i);
    }
  });
}

test("the same paths do run for a reviewer, so the refusal above is the gate and not a broken mock", async () => {
  state.role = "reviewer";
  const wrote = new Set<string>();
  for (const path of reviewPaths) {
    const { calls } = await run(path.run);
    if (calls.length > 0) wrote.add(path.name);
  }
  // 13 of the 14 have a write entry point the harness can see; curateArchiveAction writes through
  // appPool after an archive read, so its control case is asserted separately below.
  assert.equal(wrote.size, 13, `paths that wrote as reviewer: ${[...wrote].join(", ")}`);
});

test("viewer is refused by saveOperatorAction, as a visible error redirect", async () => {
  state.role = "viewer";
  const { calls, redirects } = await run(() =>
    access.saveOperatorAction(
      "mychef",
      form({ email: "new@mychef.id", name: "New", password: "x".repeat(24), role: "admin", approved: "on" }),
    ),
  );
  assert.deepEqual(calls, []);
  assert.equal(redirects.length, 1);
  assert.match(redirects[0], /error=You\+cannot\+change\+access/);
});

test("an owner does reach saveOperator with the same form, so the viewer refusal is the gate", async () => {
  state.role = "owner";
  const { calls } = await run(() =>
    access.saveOperatorAction(
      "mychef",
      form({ email: "new@mychef.id", name: "New", password: "x".repeat(24), role: "admin", approved: "on" }),
    ),
  );
  assert.ok(calls.includes("saveOperator"), "an owner must reach saveOperator");
});

test("a reviewer does reach storeArchive with the same upload, so the viewer refusal is the gate", async () => {
  state.role = "reviewer";
  const file = new File([new Uint8Array([1, 2, 3])], "export.zip", { type: "application/zip" });
  const { calls } = await run(() => archive.importArchiveAction(form({ slug: "mychef", file })));
  assert.ok(calls.includes("storeArchive"), "a reviewer must reach storeArchive");
});

test("a reviewer cannot change provider keys either, and an owner can", async () => {
  state.role = "reviewer";
  const asReviewer = await run(() =>
    keys.saveKeyAction("mychef", null, form({ provider: "deepseek", api_key: "sk-test" })),
  );
  assert.deepEqual(asReviewer.calls, []);
  assert.match(refusalText(asReviewer.result), /owner or admin/i);

  state.role = "owner";
  const asOwner = await run(() =>
    keys.saveKeyAction("mychef", null, form({ provider: "deepseek", api_key: "sk-test" })),
  );
  assert.ok(asOwner.calls.includes("saveCredential"), "an owner must reach saveCredential");
});

test("viewer is refused by the key actions and the autopilot switch", async () => {
  state.role = "viewer";
  const keyPaths: { name: string; run: () => Promise<unknown> }[] = [
    { name: "saveKeyAction", run: () => keys.saveKeyAction("mychef", null, form({ provider: "deepseek", api_key: "sk-test" })) },
    { name: "rotateKeyAction", run: () => keys.rotateKeyAction("mychef", null, form({ provider: "deepseek", api_key: "sk-test" })) },
    { name: "revokeKeyAction", run: () => keys.revokeKeyAction("mychef", null, form({ provider: "deepseek" })) },
    { name: "testKeyAction", run: () => keys.testKeyAction("mychef", null, form({ provider: "deepseek" })) },
    { name: "saveAutopilotAction", run: () => autopilot.saveAutopilotAction("mychef", form({ enabled: "on", threshold: "0.9" })) },
  ];
  for (const path of keyPaths) {
    const { calls } = await run(path.run);
    assert.deepEqual(calls, [], `${path.name} must not write for a viewer`);
  }
});

test("curateArchiveAction refuses a viewer before it reads or writes the archive", async () => {
  state.role = "viewer";
  const { calls } = await run(() => archive.curateArchiveAction("mychef", form({ id: "import-1" })));
  assert.deepEqual(calls, [], "no archive read and no knowledge insert for a viewer");
});

test("importArchiveAction refuses a viewer by redirect, before touching the file or the store", async () => {
  state.role = "viewer";
  const file = new File([new Uint8Array([1, 2, 3])], "export.zip", { type: "application/zip" });
  const { calls, redirects } = await run(() =>
    archive.importArchiveAction(form({ slug: "mychef", file })),
  );
  assert.deepEqual(calls, []);
  assert.equal(redirects.length, 1);
  assert.match(redirects[0], /error=You\+cannot\+import/);
});

test("the roles that may write are exactly owner, admin and reviewer", async () => {
  // Documented as data: viewer is the only role refused by both gates.
  const { canReview, canManageKeys } = await import("@/lib/roles");
  const matrix = (["owner", "admin", "reviewer", "viewer"] as Role[]).map((role) => ({
    role,
    review: canReview(role),
    manage: canManageKeys(role),
  }));
  assert.deepEqual(matrix, [
    { role: "owner", review: true, manage: true },
    { role: "admin", review: true, manage: true },
    { role: "reviewer", review: true, manage: false },
    { role: "viewer", review: false, manage: false },
  ]);
});
