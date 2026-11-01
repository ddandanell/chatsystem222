/**
 * MC-003: the page must say which build is serving it.
 *
 * The regression: a release record named deployment dpl_2wYNEEg… while console.mychef.id served
 * dpl_3wwb2wJ… — a newer production build nobody recorded — and nothing on the page disagreed.
 *
 * These are pure tests over the environment mapping plus static checks that the chip is actually
 * mounted in the console shell and on the sign-in page. The live check (the id rendered in the HTML
 * equals the id the host reports) is done separately against a running build; a unit test cannot
 * invent a host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deploymentLine,
  readDeploymentInfo,
} from "@/lib/deployment-info";

const ROOT = process.cwd();

function source(relative: string): string {
  return readFileSync(join(ROOT, relative), "utf8");
}

test("VERCEL_ENV=production reads PROD with the deployment id and a 7-character commit", () => {
  const info = readDeploymentInfo({
    VERCEL_ENV: "production",
    VERCEL_DEPLOYMENT_ID: "dpl_3wwb2wJKpAh3SkJHjSxHDbaN8xRx",
    VERCEL_GIT_COMMIT_SHA: "e5319b3a4b8c0d1e2f3a4b5c6d7e8f9012345678",
    VERCEL_GIT_COMMIT_REF: "main",
    NODE_ENV: "production",
  });
  assert.equal(info.environment, "production");
  assert.equal(info.label, "PROD");
  assert.equal(info.deploymentId, "dpl_3wwb2wJKpAh3SkJHjSxHDbaN8xRx");
  assert.equal(info.commitSha, "e5319b3");
  assert.equal(info.commitRef, "main");
  assert.match(deploymentLine(info), /^PROD · dpl_3wwb2wJKpAh3SkJHjSxHDbaN8xRx · e5319b3$/);
});

test("VERCEL_ENV=preview reads PREVIEW, never PROD", () => {
  const info = readDeploymentInfo({
    VERCEL_ENV: "preview",
    VERCEL_DEPLOYMENT_ID: "dpl_previewExample",
    NODE_ENV: "production",
  });
  assert.equal(info.environment, "preview");
  assert.equal(info.label, "PREVIEW");
  assert.notEqual(info.label, "PROD");
});

test("VERCEL_ENV=development reads LOCAL", () => {
  const info = readDeploymentInfo({ VERCEL_ENV: "development", NODE_ENV: "development" });
  assert.equal(info.environment, "local");
  assert.equal(info.label, "LOCAL");
});

test("no VERCEL_ENV outside production reads LOCAL", () => {
  const info = readDeploymentInfo({ NODE_ENV: "development" });
  assert.equal(info.label, "LOCAL");
});

test("no VERCEL_ENV with NODE_ENV=production reads UNKNOWN, not PROD", () => {
  // A local `next start` is a real production build; it is still not the recorded Vercel host.
  const info = readDeploymentInfo({ NODE_ENV: "production", VERCEL_DEPLOYMENT_ID: undefined });
  assert.equal(info.environment, "unknown");
  assert.equal(info.label, "UNKNOWN");
  assert.notEqual(info.label, "PROD");
});

test("an unrecognised VERCEL_ENV value is not silently promoted to PROD", () => {
  const info = readDeploymentInfo({ VERCEL_ENV: "staging", NODE_ENV: "production" });
  assert.notEqual(info.label, "PROD");
  assert.equal(info.environment, "unknown");
});

test("missing values are stated, never invented", () => {
  const info = readDeploymentInfo({ VERCEL_ENV: "preview" });
  assert.equal(info.deploymentId, null);
  assert.equal(info.commitSha, null);
  assert.equal(info.commitRef, null);
  assert.equal(deploymentLine(info), "PREVIEW · no deployment id · no commit");
});

test("whitespace-only variables count as missing", () => {
  const info = readDeploymentInfo({
    VERCEL_ENV: "production",
    VERCEL_DEPLOYMENT_ID: "   ",
    VERCEL_GIT_COMMIT_SHA: "  ",
  });
  assert.equal(info.deploymentId, null);
  assert.equal(info.commitSha, null);
});

test("a short commit is left alone, not padded or truncated into nonsense", () => {
  assert.equal(readDeploymentInfo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc" }).commitSha, "abc");
  assert.equal(
    readDeploymentInfo({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "e5319b3a4b8c" }).commitSha,
    "e5319b3",
  );
});

test("the label carries no secret and no host address", () => {
  const info = readDeploymentInfo({
    VERCEL_ENV: "production",
    VERCEL_DEPLOYMENT_ID: "dpl_x",
    VERCEL_GIT_COMMIT_SHA: "e5319b3",
    AUTH_SECRET: "should-never-be-read",
    DATABASE_URL: "postgres://user:pass@host/db",
  });
  const line = deploymentLine(info);
  assert.doesNotMatch(line, /should-never-be-read|postgres:\/\/|pass@/);
});

test("the console shell renders the chip", () => {
  const layout = source("src/app/[workspace]/layout.tsx");
  assert.match(layout, /import \{ EnvironmentBadge \} from "@\/components\/environment-badge"/);
  assert.match(layout, /<(EnvironmentBadge)\s*\/>/);
});

test("the sign-in page renders the chip, because that is where the mismatch was seen", () => {
  const page = source("src/app/login/page.tsx");
  assert.match(page, /import \{ EnvironmentBadge \} from "@\/components\/environment-badge"/);
  assert.match(page, /<EnvironmentBadge className=/);
});

test("the chip exposes machine-readable attributes for the release check", () => {
  const component = source("src/components/environment-badge.tsx");
  for (const attribute of ["data-environment", "data-deployment-id", "data-commit"]) {
    assert.match(component, new RegExp(attribute), `${attribute} missing`);
  }
  assert.match(component, /readDeploymentInfo|currentDeploymentInfo/);
});
