/**
 * Inbound webhook authentication. Fail closed: no secret means no inbound event.
 *
 * Before this module, `authorizeGhl` accepted any request whenever GHL_WEBHOOK_SECRET was unset,
 * so a missing environment variable silently turned the endpoint public, and the route writes
 * contacts, conversations, messages and drafts.
 *
 * Rules, in order:
 *  1. A blank/absent secret refuses the request (503) unless a local, explicit opt-in is set and
 *     we are not in production. Refusal status is 503 (misconfiguration), never 401.
 *  2. A presented secret is compared in constant time, on both the `x-ghl-secret` header and a
 *     bearer token, and must match exactly.
 *  3. If a timestamp header is present it must be within the skew window; a stale or future
 *     timestamp is refused (401) even when the secret matches, so a captured request cannot be
 *     replayed later.
 *
 * This module performs no I/O and no database access, so it is fully unit-testable.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type WebhookAuthResult =
  | { ok: true; verified: boolean; reason: "verified" | "unverified-local" }
  | { ok: false; status: 401 | 503; reason: string };

export const WEBHOOK_SKEW_SECONDS = 300;

type HeaderReader = { get(name: string): string | null };

function envValue(env: Record<string, string | undefined>, name: string): string {
  return (env[name] ?? "").trim();
}

/** Constant-time comparison that does not leak length through an early return. */
function sameSecret(presented: string, secret: string): boolean {
  if (presented.length === 0) return false;
  const left = createHash("sha256").update(presented, "utf8").digest();
  const right = createHash("sha256").update(secret, "utf8").digest();
  const equal = timingSafeEqual(left, right);
  // A hash match on different-length inputs is not a real match; require exact equality too.
  return equal && presented.length === secret.length;
}

function timestampWithinSkew(raw: string, nowMs: number): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  // Accept both second and millisecond epochs, because the sender's format is not pinned yet.
  const asMs = trimmed.length <= 10 ? value * 1000 : value;
  if (!Number.isFinite(asMs) || asMs <= 0) return false;
  return Math.abs(nowMs - asMs) <= WEBHOOK_SKEW_SECONDS * 1000;
}

export function authorizeWebhook(
  headers: HeaderReader,
  options: { env?: Record<string, string | undefined>; nowMs?: number } = {},
): WebhookAuthResult {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const secret = envValue(env, "GHL_WEBHOOK_SECRET");

  if (!secret) {
    const localOptIn = envValue(env, "MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS") === "1";
    const production = envValue(env, "NODE_ENV") === "production";
    if (localOptIn && !production) return { ok: true, verified: false, reason: "unverified-local" };
    return {
      ok: false,
      status: 503,
      reason: "This endpoint is not configured: no webhook secret is set, so no event is accepted.",
    };
  }

  const candidates = [
    headers.get("x-ghl-secret") ?? "",
    (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ];
  if (!candidates.some((value) => sameSecret(value, secret))) {
    return { ok: false, status: 401, reason: "Webhook secret was rejected." };
  }

  const rawTimestamp = headers.get("x-ghl-timestamp");
  if (rawTimestamp !== null && !timestampWithinSkew(rawTimestamp, nowMs)) {
    return { ok: false, status: 401, reason: "Webhook timestamp is missing, stale or malformed." };
  }

  return { ok: true, verified: true, reason: "verified" };
}
