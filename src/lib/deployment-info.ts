/**
 * Which build is this? MC-003.
 *
 * A release record named one deployment while the live host served a newer one, and nothing on the
 * page said so. This module turns the host's own environment variables into one small, fixed label
 * an operator can read and quote: PROD / PREVIEW / LOCAL, the deployment id, and the commit.
 *
 * Pure function over an injected env object, so the mapping is unit-tested without a host and the
 * same values render on the server and in the browser. No secret is read: these three variables are
 * public build metadata.
 */

export type DeploymentEnvironment = "production" | "preview" | "local" | "unknown";

export interface DeploymentInfo {
  /** Raw class of build. */
  environment: DeploymentEnvironment;
  /** Short, fixed word shown in the badge. */
  label: "PROD" | "PREVIEW" | "LOCAL" | "UNKNOWN";
  /** `dpl_…` on Vercel, otherwise null. Never invented. */
  deploymentId: string | null;
  /** First 7 characters of the deployed commit, or null when the host did not say. */
  commitSha: string | null;
  /** Branch or tag the host built, when it says so. */
  commitRef: string | null;
  /** One sentence for the title attribute: what the label is based on. */
  detail: string;
}

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Map a host environment to the label.
 *
 * - VERCEL_ENV=production → PROD
 * - VERCEL_ENV=preview    → PREVIEW
 * - VERCEL_ENV=development → LOCAL
 * - no VERCEL_ENV at all: this process is not on Vercel. With NODE_ENV=production that is still a
 *   real server, but it is not the recorded production host, so it says UNKNOWN rather than
 *   borrowing PROD. `npm run dev` says LOCAL.
 */
export function readDeploymentInfo(env: Env): DeploymentInfo {
  const vercelEnv = clean(env.VERCEL_ENV)?.toLowerCase() ?? null;
  const nodeEnv = clean(env.NODE_ENV)?.toLowerCase() ?? null;
  const commitShaFull = clean(env.VERCEL_GIT_COMMIT_SHA);
  const commitSha = commitShaFull ? commitShaFull.slice(0, 7) : null;
  const commitRef = clean(env.VERCEL_GIT_COMMIT_REF);
  const deploymentId = clean(env.VERCEL_DEPLOYMENT_ID);

  let environment: DeploymentEnvironment;
  let label: DeploymentInfo["label"];
  let detail: string;

  if (vercelEnv === "production") {
    environment = "production";
    label = "PROD";
    detail = "Served by Vercel with VERCEL_ENV=production.";
  } else if (vercelEnv === "preview") {
    environment = "preview";
    label = "PREVIEW";
    detail = "A Vercel preview build: not the production host.";
  } else if (vercelEnv === "development") {
    environment = "local";
    label = "LOCAL";
    detail = "VERCEL_ENV=development: a local build, not the production host.";
  } else if (nodeEnv === "production") {
    environment = "unknown";
    label = "UNKNOWN";
    detail = "No VERCEL_ENV: this build did not come from the recorded Vercel project.";
  } else {
    environment = "local";
    label = "LOCAL";
    detail = "No VERCEL_ENV and NODE_ENV is not production: a local build.";
  }

  return { environment, label, deploymentId, commitSha, commitRef, detail };
}

/** The line an operator reads: `PROD · dpl_abc · e5319b3`, with dashes for what the host did not say. */
export function deploymentLine(info: DeploymentInfo): string {
  return [info.label, info.deploymentId ?? "no deployment id", info.commitSha ?? "no commit"]
    .join(" · ");
}

/**
 * The phone line: `PROD · e5319b3`. UX-0224.
 *
 * The deployment id is 30+ characters on its own, so the full line cannot sit beside the workspace
 * name at 390px and the shell header grew to 177px. The commit is the part an operator quotes back
 * in a release record, and the id is not lost: it stays on the element as `data-deployment-id` and
 * in the `title`.
 */
export function deploymentLineCompact(info: DeploymentInfo): string {
  return [info.label, info.commitSha ?? "no commit"].join(" · ");
}

/** Read this process's own environment. Server only: VERCEL_* are not exposed to the browser. */
export function currentDeploymentInfo(): DeploymentInfo {
  return readDeploymentInfo({
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    NODE_ENV: process.env.NODE_ENV,
  });
}
