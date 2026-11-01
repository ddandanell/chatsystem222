/**
 * Internal myCHEF staff/admin sign-in.
 * Layout uses shadcn/ui (Card, Field, Badge, Alert, Separator) + Tailwind tokens.
 * Controlled operators only on Neon. No credentials on this page.
 * Docs: /cursor/stores/bc-5928a827-61d1-4e52-9e4b-2d10bbb58416/docs/handoff.md
 */
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LockIcon, ShieldCheckIcon } from "lucide-react";
import { auth } from "@/auth";
import { loginAction } from "@/app/login/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { usesMychefInbox } from "@/db/mode";
import { safeCallbackTarget } from "@/lib/login-callback";
import { ensureBootstrapOperator } from "@/lib/operators";

export const metadata = { title: "Admin login" };
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

async function LoginError({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : "";
  if (error !== "1" && error !== "credentials") return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not sign in</AlertTitle>
      <AlertDescription>
        Check your email and password, or ask an owner to approve your access.
      </AlertDescription>
    </Alert>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const neon = usesMychefInbox();
  const query = await searchParams;
  // Set by the proxy when it refused a page; only an internal path is accepted.
  const callback = safeCallbackTarget(query.callbackUrl);

  return (
    <main className="flex min-h-full flex-1 flex-col bg-muted/40">
      <Suspense fallback={null}>
        <BounceIfSignedIn callback={callback} />
      </Suspense>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-4 py-10 md:px-6 md:py-16">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Internal</Badge>
          <Badge variant="outline">Staff &amp; admins</Badge>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-stretch">
          <Card className="h-full border-border/80 bg-card">
            <CardHeader className="border-b">
              <CardDescription className="font-medium tracking-[0.16em] uppercase">
                myCHEF · Inbox mychef
              </CardDescription>
              <CardTitle className="text-3xl leading-tight tracking-tight md:text-4xl">
                Internal admin login
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 pt-1">
              <p className="max-w-prose text-sm leading-6 text-muted-foreground">
                Operations console for approved myCHEF staff and administrators. Not a
                public product signup.
              </p>
              <Separator />
              <ul className="flex flex-col gap-3">
                <li className="flex gap-3 rounded-lg border bg-background/80 px-3 py-3">
                  <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Approved access only</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      Sign in with the account your owner approved for this console.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 rounded-lg border bg-background/80 px-3 py-3">
                  <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">Decision ledger</p>
                    <p className="text-sm leading-5 text-muted-foreground">
                      Review drafts and record decisions. Nothing sends itself from here.
                    </p>
                  </div>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="h-full border-border/80 bg-card">
            <CardHeader className="border-b">
              <CardTitle>Sign in</CardTitle>
              <CardDescription>
                {neon
                  ? "Use your approved myCHEF staff credentials."
                  : "Local Docker fallback for Harbor Kitchen demos."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Suspense fallback={null}>
                <LoginError searchParams={searchParams} />
              </Suspense>
              <form id="admin-login" action={loginAction} className="flex flex-col gap-5">
                {callback ? (
                  <input type="hidden" name="callbackUrl" value={callback} />
                ) : null}
                <FieldSet>
                  <FieldLegend className="sr-only">Account</FieldLegend>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                      />
                      <FieldDescription>Work email for your staff account.</FieldDescription>
                    </Field>
                    {neon ? (
                      <Field>
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <Input
                          id="password"
                          name="password"
                          type="password"
                          required
                          autoComplete="current-password"
                        />
                        <FieldDescription>Password for your approved account.</FieldDescription>
                      </Field>
                    ) : (
                      <Field>
                        <FieldLabel htmlFor="name">Name</FieldLabel>
                        <Input
                          id="name"
                          name="name"
                          autoComplete="name"
                          placeholder="Only used for a new account"
                        />
                        <FieldDescription>
                          Used when creating a local demo user.
                        </FieldDescription>
                      </Field>
                    )}
                  </FieldGroup>
                </FieldSet>
              </form>
              {!neon ? (
                <>
                  <Separator />
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Seeded local sessions</p>
                    <form action={loginAction}>
                      {callback ? (
                        <input type="hidden" name="callbackUrl" value={callback} />
                      ) : null}
                      <input type="hidden" name="email" value="maya@harbor-kitchen.example" />
                      <input type="hidden" name="name" value="Maya Chen" />
                      <Button type="submit" variant="outline" className="w-full justify-between">
                        <span>Maya Chen</span>
                        <span className="text-muted-foreground">Harbor Kitchen</span>
                      </Button>
                    </form>
                    <form action={loginAction}>
                      {callback ? (
                        <input type="hidden" name="callbackUrl" value={callback} />
                      ) : null}
                      <input type="hidden" name="email" value="jonah@northline.example" />
                      <input type="hidden" name="name" value="Jonah Hale" />
                      <Button type="submit" variant="outline" className="w-full justify-between">
                        <span>Jonah Hale</span>
                        <span className="text-muted-foreground">Northline</span>
                      </Button>
                    </form>
                  </div>
                </>
              ) : null}
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button type="submit" form="admin-login" size="lg" className="w-full sm:w-auto">
                Sign in
              </Button>
            </CardFooter>
          </Card>
        </div>

        <Alert>
          <AlertTitle>Internal console</AlertTitle>
          <AlertDescription>
            If you do not have access, ask a myCHEF owner. Do not use this page to create a
            public account.
          </AlertDescription>
        </Alert>
      </div>
    </main>
  );
}
