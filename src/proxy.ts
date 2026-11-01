/**
 * Session gate. Verifies the Auth.js JWT, not just the cookie's presence. Strips client tenant
 * headers. Leaves GHL and cron public. Do not auto-send.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loginCallback } from "@/lib/login-callback";
import {
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  checkSessionToken,
  sessionGate,
} from "@/lib/session-token";

const PUBLIC_PATHS = [
  /^\/login\/?$/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/webhooks\/ghl\/?$/,
  /^\/api\/cron\/learn\/?$/,
];

export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    const lower = key.toLowerCase();
    if (
      lower.startsWith("x-tenant-") ||
      lower === "x-org-id" ||
      lower === "x-workspace" ||
      lower === "x-org-role"
    ) {
      headers.delete(key);
    }
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((pattern) => pattern.test(pathname));

  const secure = Boolean(request.cookies.get(SECURE_SESSION_COOKIE)?.value);
  const cookieName = secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  const state = await checkSessionToken({
    token: request.cookies.get(cookieName)?.value,
    secret: process.env.AUTH_SECRET,
    cookieName,
  });

  const action = sessionGate({
    publicPath: isPublic,
    state,
    production: process.env.NODE_ENV === "production",
  });

  if (action === "login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const callback = loginCallback(pathname, request.nextUrl.search);
    if (callback) url.searchParams.set("callbackUrl", callback);
    const response = NextResponse.redirect(url);
    // A value that failed verification is not a session; drop it so the browser stops resending it.
    // A missing secret is a deployment fault, not a bad cookie, so the cookie is left alone there.
    if (state.state === "invalid" && state.reason !== "no_secret") {
      for (const name of [SESSION_COOKIE, SECURE_SESSION_COOKIE]) {
        if (request.cookies.get(name)) {
          response.cookies.set(name, "", { path: "/", maxAge: 0 });
        }
      }
    }
    return response;
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
