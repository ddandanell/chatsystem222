"use client";
/**
 * The last step of recovery: choose a new password with a one-time token.
 *
 * The token arrives in the URL and leaves in a POST body to /api/auth/reset — a fixed path, so the
 * address bar can be cleaned as soon as the change lands and the token never appears in a Referer.
 *
 * The minimum is stated up front rather than discovered after a failed submit.
 */
import { useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { CheckCircle2Icon, EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-limits";

const MESSAGES: Record<string, string> = {
  invalid: "That reset link is not valid. Request a new one.",
  expired: "That reset link has expired. Request a new one.",
  used: "That reset link has already been used. Request a new one.",
  too_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  too_long: "That password is too long.",
  too_obvious: "That password is too easy to guess. Choose another.",
  uses_account: "Do not put your sign-in address in the password.",
  blank: "Enter a new password.",
  mismatch: "The two passwords do not match.",
  network: "The console could not be reached. Try again in a moment.",
};

type Phase = "form" | "done" | "failed";

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  if (phase === "done") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>
            Your old password no longer works. Sign in with the new one.
          </AlertDescription>
        </Alert>
        <Link
          href="/login?reset=1"
          className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")}
        >
          Sign in
        </Link>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError(MESSAGES.mismatch);
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as { status?: unknown } | null;
      const status = typeof data?.status === "string" ? data.status : "invalid";
      if (status === "ok") {
        // Drop the token from the address bar; it is spent and has no business in history.
        window.history.replaceState(null, "", "/login/reset");
        setPhase("done");
        return;
      }
      setError(MESSAGES[status] ?? MESSAGES.invalid);
      setPhase(status === "invalid" || status === "expired" || status === "used" ? "failed" : "form");
    } catch {
      setError(MESSAGES.network);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <Alert variant="destructive" aria-live="assertive">
          <AlertTitle>Could not set the password</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Chrome and password managers want a username field beside a new password; the token is
          the credential here, so this one stays empty and out of the tab order. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value=""
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="new-password">New password</FieldLabel>
          <div className="relative">
            <Input
              id="new-password"
              name="password"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              className="h-11 pr-12"
              required
              value={password}
              aria-invalid={tooShort || undefined}
              aria-describedby="new-password-hint"
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
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
          <FieldDescription
            id="new-password-hint"
            className={tooShort ? "text-destructive" : undefined}
          >
            {tooShort
              ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
              : `At least ${MIN_PASSWORD_LENGTH} characters. A short phrase you will remember beats a scramble you will reset.`}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
          <Input
            id="confirm-password"
            name="confirm"
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            className="h-11"
            required
            value={confirm}
            aria-describedby="confirm-password-hint"
            onChange={(event) => {
              setConfirm(event.target.value);
              setError("");
            }}
          />
          <FieldDescription id="confirm-password-hint">
            Type it once more. Nothing is saved until both match.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        {pending ? (
          <>
            <Spinner className="size-4" />
            Saving…
          </>
        ) : (
          <>
            <KeyRoundIcon />
            Set new password
          </>
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        This link works once and stops working the moment the password is saved.
      </p>
    </form>
  );
}

/** Shown when the link cannot be used at all. */
export function ResetUnavailable({ reason }: { reason: "missing" | "expired" | "used" }) {
  const text =
    reason === "expired"
      ? "That reset link has expired. Reset links last 15 minutes."
      : reason === "used"
        ? "That reset link has already been used."
        : "This reset link is not valid.";
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <AlertTitle>Link cannot be used</AlertTitle>
        <AlertDescription>{text}</AlertDescription>
      </Alert>
      <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full")}>
        Request a new link
      </Link>
    </div>
  );
}
