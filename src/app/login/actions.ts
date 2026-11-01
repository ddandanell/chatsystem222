"use server";
/**
 * Credential sign-in. Neon checks operator hashes. Do not auto-send.
 */

import { connection } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { usesMychefInbox } from "@/db/mode";
import { safeCallbackTarget } from "@/lib/login-callback";
import { ensureBootstrapOperator } from "@/lib/operators";

export async function loginAction(formData: FormData) {
  await connection();
  if (usesMychefInbox()) {
    await ensureBootstrapOperator();
  }
  const email = formData.get("email");
  // The page carries the refused deep link through the form; only an internal path is honoured, so
  // signing in from /login?callbackUrl=/mychef/inbox?conversation=… returns to that conversation.
  const callback = safeCallbackTarget(formData.get("callbackUrl"));
  if (usesMychefInbox()) {
    try {
      await signIn("credentials", {
        email,
        password: formData.get("password"),
        redirectTo: callback ?? "/mychef/inbox",
      });
    } catch (error) {
      if (isRedirectError(error)) throw error;
      if (error instanceof AuthError) {
        redirect(
          callback
            ? "/login?error=1&callbackUrl=" + encodeURIComponent(callback)
            : "/login?error=1",
        );
      }
      throw error;
    }
    return;
  }
  await signIn("credentials", {
    email,
    name: formData.get("name"),
    redirectTo: callback ?? "/",
  });
}

export async function logoutAction() {
  await connection();
  await signOut({ redirectTo: "/login" });
}
