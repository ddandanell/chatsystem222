"use client";
/**
 * "Forgot password?" — the request half of self-service recovery.
 *
 * A person at the keyboard asks for a one-time link; the server decides whether one is issued and
 * mails it. The confirmation is identical for every input, so this sheet cannot be used to find out
 * whether an address is an operator.
 *
 * Bottom sheet on phones, right-hand sheet from sm up, via the existing Sheet component.
 * Does not send anything except this one transactional request.
 */
import { useState } from "react";
import { CheckCircle2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { NEUTRAL_FORGOT_MESSAGE } from "@/lib/reset-copy";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Phase = "form" | "sent" | "failed";

export function RecoverySheet() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(NEUTRAL_FORGOT_MESSAGE);
  const [notice, setNotice] = useState("");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reopening starts clean; the address stays so a typo can be corrected.
      setPhase("form");
      setNotice("");
      setEmailInvalid(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = email.trim();
    if (!EMAIL_SHAPE.test(candidate)) {
      setEmailInvalid(true);
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: candidate }),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as {
        message?: unknown;
        notice?: unknown;
      } | null;
      setMessage(typeof data?.message === "string" ? data.message : NEUTRAL_FORGOT_MESSAGE);
      setNotice(typeof data?.notice === "string" ? data.notice : "");
      setPhase("sent");
    } catch {
      setPhase("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 text-xs font-medium text-muted-foreground hover:text-foreground"
          />
        }
      >
        Forgot password?
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-sm max-sm:data-[side=right]:inset-y-auto max-sm:data-[side=right]:inset-x-0 max-sm:data-[side=right]:bottom-0 max-sm:data-[side=right]:h-auto max-sm:data-[side=right]:w-full! max-sm:data-[side=right]:border-t max-sm:data-[side=right]:border-l-0"
      >
        <SheetHeader className="border-b border-border/60 pb-4">
          <SheetTitle>Forgot password?</SheetTitle>
          <SheetDescription>
            We will email a one-time link to the recovery address on your operator record.
          </SheetDescription>
        </SheetHeader>

        {phase === "sent" ? (
          <div className="flex flex-col gap-4 p-4">
            <Alert aria-live="polite">
              <CheckCircle2Icon />
              <AlertTitle>Request received</AlertTitle>
              <AlertDescription>
                {message}
                {notice ? (
                  <>
                    {" "}
                    <span className="block pt-2 text-foreground">{notice}</span>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
            <SheetFooter className="p-0">
              <SheetClose
                render={<Button type="button" size="lg" className="h-11 w-full" />}
              >
                Done
              </SheetClose>
            </SheetFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-4" noValidate>
            {phase === "failed" ? (
              <Alert variant="destructive" aria-live="assertive">
                <AlertTitle>Request not sent</AlertTitle>
                <AlertDescription>
                  The console could not be reached. Try again in a moment.
                </AlertDescription>
              </Alert>
            ) : null}

            <Field>
              <FieldLabel htmlFor="recovery-email">Email</FieldLabel>
              <Input
                id="recovery-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                className="h-11"
                required
                value={email}
                aria-invalid={emailInvalid || undefined}
                aria-describedby="recovery-email-hint"
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailInvalid(false);
                }}
              />
              <FieldDescription
                id="recovery-email-hint"
                className={emailInvalid ? "text-destructive" : undefined}
              >
                {emailInvalid
                  ? "Enter the email you sign in with."
                  : "The link goes to the recovery address on file, not here."}
              </FieldDescription>
            </Field>

            <SheetFooter className="p-0">
              <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner className="size-4" />
                    Sending…
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
