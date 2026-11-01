/**
 * UX-0224: the deployment chip ate the phone header.
 *
 * Measured on the live build (console.mychef.id, dpl_E1Ku8hm7edgUYeCdCaHmFGG7zt1L, commit f4f3a28,
 * 390x844, dpr 2, signed-in reviewer): the chip rendered `PROD · dpl_E1Ku8hm7edgUYeCdCaHmFGG7zt1L ·
 * f4f3a28` at 327.9x20 on a line of its own at y=44, and the shell header measured 177px on
 * /mychef/dashboard, /mychef/inbox, /mychef/team and /mychef/audit — 21% of an 844px viewport,
 * pushing every page's content 64px down.
 *
 * The fix has two halves, and both are pinned here:
 *   1. below `sm` the chip shows `PROD · <commit>` instead of `PROD · <deployment id> · <commit>`;
 *   2. the shell's own rhythm (padding and gaps) is one step tighter below `sm`.
 *
 * The live marker contract is unchanged: `data-deployment-id` and `data-commit` stay on the element,
 * because the release check reads those attributes, not the visible text. The full line is still
 * what renders from `sm` up and still what the `title` carries.
 *
 * The pixel number itself is measured against a running build, not asserted here; this file proves
 * the two changes exist and that the pure formatter does what the layout needs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deploymentLine, deploymentLineCompact, readDeploymentInfo } from "@/lib/deployment-info";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PRODUCTION = readDeploymentInfo({
  VERCEL_ENV: "production",
  VERCEL_DEPLOYMENT_ID: "dpl_E1Ku8hm7edgUYeCdCaHmFGG7zt1L",
  VERCEL_GIT_COMMIT_SHA: "f4f3a2881feaab80fa8bc4353b1104039496a8b1",
  VERCEL_GIT_COMMIT_REF: "main",
  NODE_ENV: "production",
});

test("the phone line keeps the commit's first 7 characters and drops the deployment id", () => {
  assert.equal(deploymentLineCompact(PRODUCTION), "PROD · f4f3a28");
  assert.equal(PRODUCTION.commitSha?.length, 7);
  assert.doesNotMatch(deploymentLineCompact(PRODUCTION), /dpl_/);
});

test("the full line is unchanged, so `sm` and up still name the deployment", () => {
  assert.equal(
    deploymentLine(PRODUCTION),
    "PROD · dpl_E1Ku8hm7edgUYeCdCaHmFGG7zt1L · f4f3a28",
  );
});

test("a host that reports no commit says so instead of inventing one", () => {
  const bare = readDeploymentInfo({ VERCEL_ENV: "preview", NODE_ENV: "production" });
  assert.equal(deploymentLineCompact(bare), "PREVIEW · no commit");
  assert.doesNotMatch(deploymentLineCompact(bare), /dpl_|undefined|null/);
});

test("the phone line is at least 30 characters shorter than the full line", () => {
  // 328px of 11px mono does not fit beside the workspace name at 390px; ~14 characters does.
  assert.ok(
    deploymentLine(PRODUCTION).length - deploymentLineCompact(PRODUCTION).length >= 30,
    `full ${deploymentLine(PRODUCTION).length} vs compact ${deploymentLineCompact(PRODUCTION).length}`,
  );
});

test("the chip renders the compact line below sm and keeps the full line from sm up", () => {
  const badge = read("src/components/environment-badge.tsx");
  assert.match(badge, /deploymentLineCompact\(info\)/);
  assert.match(badge, /deploymentLine\(info\)/);
  // `hidden sm:inline` for the full line, `sm:hidden` for the compact one.
  assert.match(badge, /className="hidden sm:inline"[^>]*data-slot="deployment-full"/);
  assert.match(badge, /className="sm:hidden"[^>]*data-slot="deployment-compact"/);
});

test("the live-marker attributes survive the split", () => {
  const badge = read("src/components/environment-badge.tsx");
  assert.match(badge, /data-environment=\{info\.environment\}/);
  assert.match(badge, /data-deployment-id=\{info\.deploymentId \?\? "none"\}/);
  assert.match(badge, /data-commit=\{info\.commitSha \?\? "none"\}/);
  // The full line stays readable on hover and for a screen reader, so the id is not lost on a phone.
  assert.match(badge, /title=\{`\$\{info\.detail\} Deployment \$\{info\.deploymentId \?\? "not reported"\}/);
});

test("the shell's rhythm is tighter below sm, and unchanged from sm up", () => {
  const layout = read("src/app/[workspace]/layout.tsx");
  const header = layout.match(
    /<div className="mx-auto flex w-full max-w-6xl flex-col ([^"]+)">/,
  );
  assert.ok(header, "the shell header container was not found");
  const classes = header[1];
  assert.match(classes, /\bgap-2\b/);
  assert.match(classes, /\bpy-1\.5\b/);
  assert.match(classes, /\bsm:gap-3\b/);
  assert.match(classes, /\bsm:py-3\b/);
  // No un-prefixed `gap-3`/`py-3` may survive, or the phone keeps the taller header.
  assert.doesNotMatch(classes, /(^|\s)gap-3(\s|$)/);
  assert.doesNotMatch(classes, /(^|\s)py-3(\s|$)/);
  assert.doesNotMatch(classes, /(^|\s)py-2(\s|$)/);
});

test("the loading skeleton matches the header it replaces, so nothing jumps", () => {
  const layout = read("src/app/[workspace]/layout.tsx");
  const skeleton = layout.match(
    /<div className="mx-auto flex w-full max-w-6xl animate-pulse flex-col ([^"]+)">/,
  );
  assert.ok(skeleton, "the header skeleton was not found");
  assert.match(skeleton[1], /\bgap-2\b/);
  assert.match(skeleton[1], /\bsm:gap-3\b/);
});
