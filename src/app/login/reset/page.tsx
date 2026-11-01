/**
 * /login/reset — where an emailed reset link lands.
 *
 * Public by necessity (the visitor has no session, that is the whole point), so the page itself
 * decides what to show by asking the database whether the token can still be spent. It never
 * changes anything: the POST to /api/auth/reset does that, with the token in the body.
 *
 * The link is validated before the form is drawn, so an expired link is a plain explanation
 * instead of a form that fails on submit.
 */
import { BrandPanel, MobileLockup, SupportFooter } from "@/components/login/brand-panel";
import { ResetForm, ResetUnavailable } from "@/components/login/reset-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usesMychefInbox } from "@/db/mode";
import { inspectResetToken, type ResetVerdictForPage } from "@/lib/operator-recovery";

export const metadata = { title: "Choose a new password" };
export const instant = false;

async function verdictFor(token: string): Promise<ResetVerdictForPage> {
  if (!usesMychefInbox()) return "missing";
  try {
    return await inspectResetToken(token);
  } catch {
    // A database that cannot answer is not a licence to show a form that would fail anyway.
    return "missing";
  }
}

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const verdict = token ? await verdictFor(token) : "missing";

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-muted/40 lg:grid lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)]">
      <BrandPanel />

      <div className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <div className="mx-auto flex w-full max-w-[420px] flex-col">
          <MobileLockup />

          <div className="animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="border-b border-border/60">
                <CardTitle className="text-xl tracking-tight">Choose a new password</CardTitle>
                <CardDescription>
                  {verdict === "valid"
                    ? "This link works once, then it stops working."
                    : "This link can no longer be used."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {verdict === "valid" ? (
                  <ResetForm token={token} />
                ) : (
                  <ResetUnavailable reason={verdict} />
                )}
              </CardContent>
            </Card>
          </div>

          <SupportFooter />
        </div>
      </div>
    </main>
  );
}
