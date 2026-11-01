/**
 * POST /api/auth/reset — spend a one-time token and set the new password.
 *
 * Under /api/auth, so the proxy already treats it as public and this adds no line to proxy.ts.
 * The token arrives in the body, never in this URL, so it cannot leak through a Referer if the
 * response ever renders a link.
 *
 * Answers with a status word and nothing else: no token, no hash, no operator identity, and the
 * same shape for a wrong token as for an expired one to a stranger.
 */
import type { NextRequest } from "next/server";
import { completeReset } from "@/lib/operator-recovery";

function statusResponse(status: string) {
  return Response.json({ status }, { status: 200, headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let token: unknown;
  let password: unknown;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { token?: unknown; password?: unknown } | null;
      token = body?.token;
      password = body?.password;
    } else {
      const form = await request.formData();
      token = form.get("token");
      password = form.get("password");
    }
  } catch {
    return statusResponse("invalid");
  }

  try {
    const outcome = await completeReset({ token, password });
    if (outcome.ok) {
      console.info("reset_completed");
      return statusResponse("ok");
    }
    // Code only: the reason names no address and reveals nothing a token holder does not already have.
    console.info(`reset_failed=${outcome.code}`);
    return statusResponse(outcome.code);
  } catch (error) {
    console.error(`reset_error kind=${error instanceof Error ? error.name : "unknown"}`);
    return statusResponse("invalid");
  }
}
