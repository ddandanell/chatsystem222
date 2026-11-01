/**
 * POST /api/auth/forgot — request a password-reset link.
 *
 * Under /api/auth so the proxy already treats it as public; it therefore adds no line to
 * proxy.ts, which is the file #15 and this branch both touch.
 *
 * Answers the same thing for every input: an unknown address, a disabled operator, a missing
 * recovery address, a rate-limited request and a real send all produce one neutral 200. The mail
 * itself is scheduled with `after()` so the response does not wait on Nylas and the time it takes
 * cannot be used to tell a registered address from an unregistered one.
 *
 * Never returns the token, the hash, the recovery address or the reason.
 */
import { after, type NextRequest } from "next/server";
import { NEUTRAL_FORGOT_MESSAGE, UNCONFIGURED_RECOVERY_MESSAGE } from "@/lib/reset-copy";
import { resetTransport } from "@/lib/operator-recovery";
import { deliverResetMail, requestReset } from "@/lib/operator-recovery";

function requestAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function requestBaseUrl(request: NextRequest): string | null {
  if (process.env.AUTH_URL) return process.env.AUTH_URL;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function readEmail(request: NextRequest): Promise<string> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { email?: unknown } | null;
      return typeof body?.email === "string" ? body.email : "";
    }
    const form = await request.formData();
    const value = form.get("email");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function neutralResponse(transport: "configured" | "unconfigured") {
  return Response.json(
    {
      status: "neutral",
      message: NEUTRAL_FORGOT_MESSAGE,
      // Global server state, identical for every caller: it cannot reveal whether an account exists.
      recovery: transport,
      ...(transport === "unconfigured" ? { notice: UNCONFIGURED_RECOVERY_MESSAGE } : {}),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const transport = resetTransport();
  const email = await readEmail(request);

  // No transport: answer neutrally and say so, without touching a row or minting a token nobody
  // could receive.
  if (transport === "unconfigured") {
    console.warn("reset_transport=unconfigured");
    return neutralResponse(transport);
  }

  try {
    const outcome = await requestReset({
      email,
      address: requestAddress(request),
      baseUrl: requestBaseUrl(request),
    });
    if (outcome.issued && outcome.link && outcome.to) {
      const { link, to } = outcome;
      const account = email.trim().toLowerCase();
      const send = () => deliverResetMail({ to, link, email: account });
      try {
        after(send);
      } catch {
        // Outside a request scope there is no `after`; the send must still happen.
        await send();
      }
    } else {
      // The reason stays on the server: it is not in the response body and it names no address.
      console.info(`reset_request=${outcome.reason}`);
    }
  } catch (error) {
    console.error(
      `reset_request=error kind=${error instanceof Error ? error.name : "unknown"}`,
    );
  }

  return neutralResponse(transport);
}
