/**
 * The shared shell of the two public pages: /login and /login/reset.
 *
 * Server components only — no state, no effects. Keeping them here means the reset page cannot
 * drift visually from the sign-in page, which is what a person lands on when something has already
 * gone wrong.
 */
import { KeyRoundIcon, LockIcon, ShieldCheckIcon } from "lucide-react";

/** Where an operator without access asks for it. A monitor address, not a mailbox on mychef.id. */
export const SUPPORT_EMAIL = "bali@private-chef-in-bali.online";

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

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="text-lg font-semibold tracking-[0.02em]">myCHEF</span>
      <span className="ml-2 text-[0.7rem] font-medium tracking-[0.22em] uppercase opacity-60">
        Inbox
      </span>
    </div>
  );
}

export function BrandPanel() {
  return (
    <section className="relative hidden overflow-hidden bg-brand-panel text-brand-panel-foreground lg:flex lg:flex-col lg:justify-between lg:gap-8 lg:p-10 xl:p-14">
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

/** Mobile lockup above the card: the panel collapses to this below lg. */
export function MobileLockup() {
  return (
    <div className="mb-6 flex items-center justify-between lg:hidden">
      <Wordmark className="text-foreground" />
      <span className="text-[0.65rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        Bali
      </span>
    </div>
  );
}

export function SupportFooter() {
  return (
    <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
      Internal console — access by invitation.{" "}
      <a
        href={`mailto:${SUPPORT_EMAIL}`}
        className="inline-flex min-h-11 items-center px-1 align-middle font-medium text-foreground underline-offset-4 hover:underline"
      >
        Contact support
      </a>
    </p>
  );
}
