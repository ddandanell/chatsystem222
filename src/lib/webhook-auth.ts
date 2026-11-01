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
 *  2. A freshness proof is always required. `x-ghl-timestamp` must be present and within the skew
 *     window. A missing timestamp is refused, not skipped: with a static shared secret, skipping
 *     it would leave a captured request replayable forever.
 *  3. Two acceptance modes, decided by configuration, never by the sender:
 *       - signature: `x-ghl-signature: sha256=<hex>` is HMAC-SHA256 over `${timestamp}.${rawBody}`.
 *         Used whenever the header is present, and mandatory when GHL_WEBHOOK_REQUIRE_SIGNATURE=1.
 *       - shared-secret: `x-ghl-secret` header or `Authorization: Bearer`, compared in constant
 *         time. Only this mode is replay-bounded by the timestamp window alone, so it is the
 *         weaker mode; `applyGhlPayload` additionally de-duplicates on the event key, which turns
 *         a replay inside the window into a no-op instead of a second draft.
 *
 * This module performs no I/O and no database access, so it is fully unit-testable.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type WebhookAuthMode = "signature" | "shared-secret" | "unverified-local";

export type WebhookAuthResult =
  | { ok: true; verified: boolean; mode: WebhookAuthMode; reason: "verified" | "unverified-local" }
  | { ok: false; status: 401 | 503; reason: string };

export const WEBHOOK_SKEW_SECONDS = 300;
export const TIMESTAMP_HEADER = "x-ghl-timestamp";
export const SIGNATURE_HEADER = "x-ghl-signature";

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

/** The exact string a sender must sign. Exported so the adapter and the tests agree. */
export function signatureBase(timestamp: string, rawBody: string): string {
  return `${timestamp.trim()}.${rawBody}`;
}

/** `sha256=<hex>` HMAC over `${timestamp}.${rawBody}`. */
export function signWebhookBody(secret: string, timestamp: string, rawBody: string): string {
  const hex = createHmac("sha256", secret).update(signatureBase(timestamp, rawBody), "utf8").digest("hex");
  return `sha256=${hex}`;
}

function signatureMatches(presented: string, secret: string, timestamp: string, rawBody: string): boolean {
  const raw = presented.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) return false;
  const expected = createHmac("sha256", secret).update(signatureBase(timestamp, rawBody), "utf8").digest();
  const given = Buffer.from(raw, "hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function authorizeWebhook(
  headers: HeaderReader,
  options: {
    env?: Record<string, string | undefined>;
    nowMs?: number;
    /** Raw request body, required to verify a signature. Absent means "cannot verify". */
    rawBody?: string;
  } = {},
): WebhookAuthResult {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const secret = envValue(env, "GHL_WEBHOOK_SECRET");

  if (!secret) {
    const localOptIn = envValue(env, "MYCHEF_ALLOW_UNVERIFIED_WEBHOOKS") === "1";
    const production = envValue(env, "NODE_ENV") === "production";
    if (localOptIn && !production) {
      return { ok: true, verified: false, mode: "unverified-local", reason: "unverified-local" };
    }
    return {
      ok: false,
      status: 503,
      reason: "This endpoint is not configured: no webhook secret is set, so no event is accepted.",
    };
  }

  const rawTimestamp = headers.get(TIMESTAMP_HEADER);
  if (rawTimestamp === null || rawTimestamp.trim() === "") {
    return {
      ok: false,
      status: 401,
      reason: `Webhook ${TIMESTAMP_HEADER} is required, so a captured request cannot be replayed later.`,
    };
  }
  if (!timestampWithinSkew(rawTimestamp, nowMs)) {
    return { ok: false, status: 401, reason: "Webhook timestamp is stale or malformed." };
  }
  const timestamp = rawTimestamp.trim();

  const presentedSignature = headers.get(SIGNATURE_HEADER);
  if (presentedSignature !== null && presentedSignature.trim() !== "") {
    if (options.rawBody === undefined) {
      return {
        ok: false,
        status: 401,
        reason: "A signature was presented but the raw body was not available to verify it.",
      };
    }
    if (!signatureMatches(presentedSignature, secret, timestamp, options.rawBody)) {
      return { ok: false, status: 401, reason: "Webhook signature was rejected." };
    }
    return { ok: true, verified: true, mode: "signature", reason: "verified" };
  }

  if (envValue(env, "GHL_WEBHOOK_REQUIRE_SIGNATURE") === "1") {
    return {
      ok: false,
      status: 401,
      reason: "This sender must sign its events: x-ghl-signature is required.",
    };
  }

  const candidates = [
    headers.get("x-ghl-secret") ?? "",
    (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ];
  if (!candidates.some((value) => sameSecret(value.trim(), secret))) {
    return { ok: false, status: 401, reason: "Webhook secret was rejected." };
  }

  return { ok: true, verified: true, mode: "shared-secret", reason: "verified" };
}
