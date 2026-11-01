"use client";
/**
 * The sign-in card: email, password, reveal, pending state via useFormStatus.
 *
 * Deliberately client-side: the reveal toggle and the field-level invalid state need it, and
 * useFormStatus only reports a pending action from inside the form that owns it. The server
 * action is imported directly, so nothing about the credential leaves the server.
 *
 * Does not send anything. Does not accept a new password here — that is /login/reset.
 */
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2Icon, EyeIcon, EyeOffIcon } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";

const ERROR_TEXT: Record<string, { title: string; body: string }> = {
  credentials: {
    title: "Could not sign in",
    body: "That email and password do not match an approved operator. Check them, or ask an owner to approve your access.",
  },
  rate: {
    title: "Too many attempts",
    body: "Too many attempts. Try again in 15 minutes.",
  },
  expired: {
    title: "Session expired",
    body: "Your session expired. Sign in again to continue.",
  },
};

function errorCopy(code: string) {
  if (code === "1") return ERROR_TEXT.credentials;
  return ERROR_TEXT[code] ?? null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="h-11 w-full text-sm"
      disabled={pending}
    >
      {pending ? (
        <>
          <Spinner className="size-4" />
          Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </Button>
  );
}

export function LoginCard({
  error,
  resetDone,
  callback,
}: {
  error: string;
  resetDone: boolean;
  callback: string | null;
}) {
  const emailId = useId();
  const passwordId = useId();
  const emailHintId = useId();
  const passwordHintId = useId();
  const [reveal, setReveal] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const copy = errorCopy(error);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="border-b border-border/60">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Owner console</Badge>
          <Badge variant="outline">Invite only</Badge>
        </div>
        <CardTitle className="text-xl tracking-tight">Sign in</CardTitle>
        <CardDescription>
          Use the operator account your owner approved for this console.
        </CardDescription>
      </CardHeader>

      <form
        ref={formRef}
        action={loginAction}
        noValidate
        onSubmit={(event) => {
          const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            event.preventDefault();
            setEmailInvalid(true);
            event.currentTarget.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
          }
        }}
      >
        <CardContent className="flex flex-col gap-4 pt-4">
          {resetDone ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertTitle>Password updated</AlertTitle>
              <AlertDescription>Sign in with your new password.</AlertDescription>
            </Alert>
          ) : null}

          {copy ? (
            <Alert variant="destructive">
              <AlertTitle>{copy.title}</AlertTitle>
              <AlertDescription>{copy.body}</AlertDescription>
            </Alert>
          ) : null}

          {callback ? (
            <input type="hidden" name="callbackUrl" value={callback} />
          ) : null}

          <FieldSet>
            <FieldLegend className="sr-only">Operator credentials</FieldLegend>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                <Input
                  id={emailId}
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11"
                  aria-describedby={emailHintId}
                  aria-invalid={emailInvalid || undefined}
                  onInput={() => setEmailInvalid(false)}
                />
                <FieldDescription
                  id={emailHintId}
                  className={emailInvalid ? "text-destructive" : undefined}
                >
                  {emailInvalid
                    ? "Enter the email on your operator record."
                    : "The work email your access was granted to."}
                </FieldDescription>
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
                </div>
                <div className="relative">
                  <Input
                    id={passwordId}
                    name="password"
                    type={reveal ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="h-11 pr-12"
                    aria-describedby={passwordHintId}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-0.5 size-11 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={reveal ? "Hide password" : "Show password"}
                    aria-pressed={reveal}
                    onClick={() => setReveal((value) => !value)}
                  >
                    {reveal ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                </div>
                <FieldDescription id={passwordHintId}>
                  Passwords are checked against the stored hash, never sent anywhere else.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
        </CardContent>

        <CardFooter className="mt-1 flex-col gap-3 border-t border-border/60 pt-4">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}
