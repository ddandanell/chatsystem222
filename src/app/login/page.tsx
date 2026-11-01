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
import { KeyRoundIcon, LockIcon, ShieldCheckIcon } from "lucide-react";
import { auth } from "@/auth";
import { LoginCard } from "@/components/login/login-card";
import { usesMychefInbox } from "@/db/mode";
import { safeCallbackTarget } from "@/lib/login-callback";
import { ensureBootstrapOperator } from "@/lib/operators";

export const metadata = { title: "Sign in" };
export const instant = false;

/** Where an operator without access asks for it. A monitor address, not a mailbox on mychef.id. */
const SUPPORT_EMAIL = "bali@private-chef-in-bali.online";

const TRUST_POINTS = [
  {
    icon: ShieldCheckIcon,
    title: "Approved operators only",
    body: "Every account is granted by an owner. There is no public sign-up.",
  },
  {
    icon: LockIcon,
    title: "Nothing sends itself",
    body: "AI drafts wait for a person to approve them before anything leaves the console.",
  },
  {
    icon: KeyRoundIcon,
    title: "Keys stay on the server",
    body: "Provider credentials are read server-side and never reach this browser.",
  },
];

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

function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="text-lg font-semibold tracking-[0.02em]">myCHEF</span>
      <span className="ml-2 text-[0.7rem] font-medium tracking-[0.22em] uppercase opacity-60">
        Inbox
      </span>
    </div>
  );
}

function BrandPanel() {
  return (
    <section className="relative hidden overflow-hidden bg-brand-panel text-brand-panel-foreground lg:flex lg:flex-col lg:justify-between lg:p-10 lg:gap-8 xl:p-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(255,255,255,0.12),transparent_58%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(to_top,rgba(0,0,0,0.28),transparent)]"
      />

      <div className="relative">
        <Wordmark />
      </div>

      <div className="relative flex max-w-md flex-col gap-4">
        <p className="text-[0.7rem] font-medium tracking-[0.22em] uppercase opacity-60">
          Bali · Private chef service
        </p>
        <h1 className="text-[1.75rem] leading-[1.15] font-medium tracking-tight text-balance xl:text-[2rem]">
          Every guest request, in one calm place.
        </h1>
        <p className="text-sm leading-6 opacity-80">
          The operations console for the MyChef desk: inbound conversations, the knowledge
          behind each answer, and the decisions a person still has to make.
        </p>
      </div>

      <ul className="relative flex flex-col divide-y divide-white/10">
        {TRUST_POINTS.map((point) => (
          <li key={point.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <point.icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 opacity-70" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{point.title}</p>
              <p className="text-sm leading-5 opacity-70">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <Wordmark className="text-foreground" />
            <span className="text-[0.65rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Bali
            </span>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
            <LoginCard error={error} resetDone={resetDone} callback={callback} />
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
            Internal console — access by invitation.{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex min-h-11 items-center px-1 align-middle font-medium text-foreground underline-offset-4 hover:underline"
            >
              Contact support
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
