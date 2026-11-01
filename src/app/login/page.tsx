/**
 * Sign-in — the front door of the console.
 *
 * Split layout: an editorial brand panel on the left, the auth card on the right, a compact
 * lockup on mobile. No demo accounts, no seeded names, no signup copy: this page is the boundary
 * between the internet and every customer conversation MyChef holds.
 *
 * The deep-link behaviour is #15's and is unchanged: the proxy records the refused page, this
 * page validates it with safeCallbackTarget, carries it through the form, and BounceIfSignedIn
 * sends an already-signed-in visitor to the same target.
 *
 * Does not send anything. Does not create accounts.
 */
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/auth";
import {
  BrandPanel,
  MobileLockup,
  SupportFooter,
} from "@/components/login/brand-panel";
import { EnvironmentBadge } from "@/components/environment-badge";
import { LoginCard } from "@/components/login/login-card";
import { usesMychefInbox } from "@/db/mode";
import { safeCallbackTarget } from "@/lib/login-callback";
import { ensureBootstrapOperator } from "@/lib/operators";

export const metadata = { title: "Sign in" };
export const instant = false;

async function BounceIfSignedIn({ callback }: { callback: string | null }) {
  await connection();
  if (usesMychefInbox()) {
    await ensureBootstrapOperator();
  }
  const session = await auth();
  // Already signed in: go where the deep link asked for, not to the console root.
  if (session?.user?.id) redirect(callback ?? "/");
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Set by the proxy when it refused a page; only an internal path is accepted.
  const callback = safeCallbackTarget(query.callbackUrl);
  const error = typeof query.error === "string" ? query.error : "";
  const resetDone = query.reset === "1";

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-muted/40 lg:grid lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
      <Suspense fallback={null}>
        <BounceIfSignedIn callback={callback} />
      </Suspense>

      <BrandPanel />

      <div className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <div className="mx-auto flex w-full max-w-[420px] flex-col">
          <MobileLockup />

          <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
            <LoginCard error={error} resetDone={resetDone} callback={callback} />
          </div>

          <SupportFooter />
          <EnvironmentBadge className="mt-3 self-start" />
        </div>
      </div>
    </main>
  );
}
