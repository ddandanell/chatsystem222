/**
 * SEC-001: one operator session lasts 12 hours from sign-in, absolutely.
 *
 * Auth.js defaults a JWT session to 30 days and re-issues the cookie whenever the token is older
 * than `session.updateAge` (24 h by default), so a console left open renews itself indefinitely.
 * A stolen cookie is then a bearer credential for a month, silently extended every day.
 *
 * `maxAge` on its own is the JWT/cookie lifetime, not a cap: the same rolling refresh pushes it
 * forward. So the absolute clock is stamped on the token the first time it is issued (`authAt`)
 * and never rewritten; once 12 hours have passed since that stamp the session is refused and the
 * caller must sign in again. Nothing here is a rule about *who* may sign in — it only bounds how
 * long one sign-in lasts.
 */

/** 12 hours. Absolute: the stamp never moves, so idle time does not buy a longer session. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** The fields this module needs from an Auth.js JWT; the token is otherwise passed through. */
export type SessionWindowToken = Record<string, unknown> & { authAt?: unknown };

function readAuthAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Returns the token to keep (with `authAt` stamped) or `null` once the 12 hours are up.
 *
 * `nowSeconds` is passed in rather than read here so the boundary can be tested at an exact
 * second. A missing or malformed stamp means this is the first issue: stamp it now. A future
 * stamp (clock moved backwards, or a token minted elsewhere) is not trusted as an extension, so
 * it is re-stamped to now — the session can only get shorter, never longer.
 */
export function applySessionWindow(
  token: SessionWindowToken,
  nowSeconds: number,
): SessionWindowToken | null {
  const now = Math.floor(nowSeconds);
  const stamped = readAuthAt(token.authAt);
  const authAt = stamped === null || stamped > now ? now : stamped;
  if (now - authAt >= SESSION_MAX_AGE_SECONDS) return null;
  return { ...token, authAt };
}

/** Convenience for callers that only want the verdict. */
export function sessionWindowExpired(
  token: SessionWindowToken,
  nowSeconds: number,
): boolean {
  return applySessionWindow(token, nowSeconds) === null;
}
