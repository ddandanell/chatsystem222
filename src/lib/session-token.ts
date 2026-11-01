/**
 * Session cookie verification for the console proxy.
 *
 * Auth.js v5 signs the session as a JWE with AUTH_SECRET and salts it with the cookie name, so a
 * cookie value can be checked here without touching the database. The proxy used to accept the mere
 * existence of the cookie, which meant a forged value reached the app shell before the layout
 * refused it; this module makes the proxy turn it away. No password, token or secret is logged.
 */

import { decode } from "next-auth/jwt";

export const SESSION_COOKIE = "authjs.session-token";
export const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

export type SessionCheck =
  | { state: "none" }
  | { state: "valid"; subject: string | null }
  | { state: "invalid"; reason: "no_secret" | "decode_failed" | "expired" };

/**
 * Verify one cookie value. `cookieName` is the salt Auth.js used, so it must be the exact name the
 * cookie arrived under (`__Secure-` prefix on HTTPS).
 */
export async function checkSessionToken(input: {
  token: string | undefined | null;
  secret: string | undefined | null;
  cookieName: string;
}): Promise<SessionCheck> {
  const token = input.token?.trim();
  if (!token) return { state: "none" };

  const secret = input.secret?.trim();
  if (!secret) return { state: "invalid", reason: "no_secret" };

  let payload: { sub?: unknown; exp?: unknown } | null = null;
  try {
    payload = await decode<{ sub?: unknown; exp?: unknown }>({
      token,
      secret,
      salt: input.cookieName,
    });
  } catch (error) {
    // Auth.js/jose checks `exp` while decrypting and throws; keep that distinguishable from a
    // forged or tampered value so the proxy can drop the cookie for one reason and not the other.
    if (error instanceof Error && error.name === "JWTExpired") {
      return { state: "invalid", reason: "expired" };
    }
    return { state: "invalid", reason: "decode_failed" };
  }
  if (!payload) return { state: "invalid", reason: "decode_failed" };

  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
    return { state: "invalid", reason: "expired" };
  }

  return {
    state: "valid",
    subject: typeof payload.sub === "string" ? payload.sub : null,
  };
}

export type GateAction = "next" | "login";

/**
 * The decision the proxy makes, kept separate so it can be tested without a Next request.
 *
 * An invalid cookie goes to /login. The one exception is a deployment with no AUTH_SECRET outside
 * production, where Auth.js signs with an ephemeral development secret this code cannot know: there
 * the old presence check stands and the layout's getWorkspaceAccess still refuses. In production a
 * missing secret fails closed.
 */
export function sessionGate(input: {
  publicPath: boolean;
  state: SessionCheck;
  production: boolean;
}): GateAction {
  if (input.publicPath) return "next";
  if (input.state.state === "valid") return "next";
  if (input.state.state === "none") return "login";
  if (input.state.reason === "no_secret" && !input.production) return "next";
  return "login";
}
