/**
 * Password-reset rules, with no database and no network in them.
 *
 * Everything here is a pure function so the security-relevant decisions — token entitlement,
 * expiry, single use, the password floor, the rate-limit arithmetic — can be tested without a
 * connection to Neon. The storage and the mail send live in operator-recovery.ts.
 *
 * Design note: the token is 32 random bytes in base64url. Only sha256(token) is ever stored, so a
 * dump of the operator row cannot be replayed. A salt is not useful here — the token is already
 * full-entropy and single use.
 */
import { createHash, randomBytes } from "node:crypto";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password-limits";
import { RESET_MINUTES } from "@/lib/reset-copy";

export const RESET_TTL_MS = RESET_MINUTES * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_IDENTIFIER_REQUESTS = 3;
export const MAX_ADDRESS_REQUESTS = 10;
export { MIN_PASSWORD_LENGTH };
export const TOKEN_BYTES = 32;

/** base64url of 32 bytes: 43 characters, no padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type ResetState = {
  hash: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
};

export type ResetVerdict = "valid" | "missing" | "expired" | "used";

export type PasswordVerdict =
  | { ok: true }
  | { ok: false; code: "too_short" | "too_long" | "too_obvious" | "uses_account" | "blank" };

/** Obvious strings an operator or an attacker would try first. Lowercase, compared after trim. */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword123",
  "qwertyuiop",
  "qwerty12345",
  "123456789012",
  "1234567890123",
  "letmein12345",
  "letmeinplease",
  "welcome12345",
  "welcome123456",
  "admin1234567",
  "administrator",
  "iloveyou1234",
  "changeme1234",
  "changeme12345",
  "mychef123456",
  "mychefpassword",
  "mychefmychef",
  "bali12345678",
  "balipassword",
  "privatechef1",
  "privatechef12",
  "privatechef123",
  "console12345",
  "console123456",
  "dragon123456",
  "monkey123456",
  "sunshine1234",
  "trustno1trust",
  "football1234",
  "baseball1234",
  "superman1234",
  "starwars1234",
  "whatever1234",
]);

function lower(value: string) {
  return value.trim().toLowerCase();
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The key an in-memory rate limiter is allowed to hold.
 *
 * The raw IP address is personal data and is not needed to count requests, so it is never what the
 * map stores. The purpose string keeps this hash from matching the same address hashed elsewhere,
 * and 32 hex characters is plenty: the map is a best-effort cap, not a security boundary, so a
 * collision only makes two addresses share one counter.
 */
export function hashAddressKey(address: string): string {
  const material = `mychef:reset-address:${address.trim().toLowerCase()}`;
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

export type AddressWindowEntry = { attempts: number; windowStart: string };

/**
 * Keep the in-memory address window bounded, one entry at a time.
 *
 * Expired entries go first. If the map is still at the cap, the oldest entries are evicted until
 * it is under it. Clearing the whole map instead would let a flood of distinct addresses wipe every
 * live counter at once, which is the one thing an abusive client would most like to do.
 */
export function pruneAddressWindow(
  window: Map<string, AddressWindowEntry>,
  now: number,
  cap: number,
): void {
  if (window.size < cap) return;
  for (const [key, value] of window) {
    const start = Date.parse(value.windowStart);
    if (Number.isFinite(start) && now - start >= RATE_WINDOW_MS) window.delete(key);
  }
  while (window.size >= cap) {
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, value] of window) {
      const start = Date.parse(value.windowStart);
      if (Number.isFinite(start) && start < oldest) {
        oldest = start;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    window.delete(oldestKey);
  }
}

/** A fresh token and the hash that is allowed to touch the database. */
export function generateResetToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashResetToken(token) };
}

/** Cheap shape gate, so junk never reaches a query. A wrong-shaped token is simply invalid. */
export function isValidResetTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function asHash(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** The reset fields inside an operator row's config, with anything unreadable treated as absent. */
export function readResetState(config: unknown): ResetState {
  const source = (config ?? {}) as Record<string, unknown>;
  return {
    hash: asHash(source.reset_hash),
    issuedAt: asIsoDate(source.reset_issued_at),
    expiresAt: asIsoDate(source.reset_expires_at),
    usedAt: asIsoDate(source.reset_used_at),
  };
}

/** Whether the stored token may still be used, and why not when it may not. */
export function classifyReset(state: ResetState, now: number = Date.now()): ResetVerdict {
  if (!state.hash) return "missing";
  if (state.usedAt) return "used";
  if (!state.expiresAt) return "missing";
  if (Date.parse(state.expiresAt) <= now) return "expired";
  return "valid";
}

export function resetExpiry(now: number = Date.now()): string {
  return new Date(now + RESET_TTL_MS).toISOString();
}

export function resetIssuedAt(now: number = Date.now()): string {
  return new Date(now).toISOString();
}

export type AttemptState = {
  attempts: number;
  windowStart: string;
  allowed: boolean;
};

/**
 * Count this request against a fixed window.
 *
 * `limit` attempts are allowed per window; the one after that is refused. A window that is missing,
 * unreadable, older than the window, or in the future (clock skew) starts over, so a bad clock
 * cannot lock an operator out permanently.
 */
export function nextAttemptState(
  previous: { attempts?: unknown; windowStart?: unknown } | null | undefined,
  now: number = Date.now(),
  limit: number = MAX_IDENTIFIER_REQUESTS,
): AttemptState {
  const rawAttempts = Number(previous?.attempts ?? 0);
  const attempts = Number.isFinite(rawAttempts) && rawAttempts > 0 ? Math.floor(rawAttempts) : 0;
  const start = typeof previous?.windowStart === "string" ? Date.parse(previous.windowStart) : NaN;
  const stale =
    !Number.isFinite(start) || now - start >= RATE_WINDOW_MS || now - start < 0;

  if (stale) {
    return { attempts: 1, windowStart: new Date(now).toISOString(), allowed: true };
  }
  return {
    attempts: attempts + 1,
    windowStart: previous?.windowStart as string,
    allowed: attempts < limit,
  };
}

/**
 * The new-password floor for the reset path. Stricter than the 8 characters the bootstrap path
 * accepts: this is the credential an operator will actually use.
 */
export function checkPassword(password: unknown, accountEmail?: string | null): PasswordVerdict {
  if (typeof password !== "string") return { ok: false, code: "blank" };
  const candidate = password.trim();
  if (!candidate) return { ok: false, code: "blank" };
  if (candidate.length < MIN_PASSWORD_LENGTH) return { ok: false, code: "too_short" };
  if (candidate.length > MAX_PASSWORD_LENGTH) return { ok: false, code: "too_long" };

  const normalized = lower(candidate);
  if (OBVIOUS.has(normalized)) return { ok: false, code: "too_obvious" };
  // Three or fewer distinct characters is padding, not a password.
  if (new Set(normalized).size <= 3) return { ok: false, code: "too_obvious" };

  const email = lower(accountEmail ?? "");
  if (email) {
    const [local] = email.split("@");
    if (local && local.length >= 4 && normalized.includes(local)) {
      return { ok: false, code: "uses_account" };
    }
  }
  return { ok: true };
}

/** The link that goes in the mail. Returns null rather than inventing a host. */
export function buildResetLink(baseUrl: string | null | undefined, token: string): string | null {
  if (!isValidResetTokenShape(token)) return null;
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return null;
  return `${base}/login/reset?token=${encodeURIComponent(token)}`;
}

/** http(s) only, no credentials, no path prefix beyond the origin, no trailing slash. */
export function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}
