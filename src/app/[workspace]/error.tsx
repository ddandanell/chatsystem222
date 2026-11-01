"use client";
/**
 * Workspace error boundary: a console page failed, and the shell (identity, no-send banner, nav)
 * stays up around this panel so the operator can move to another page instead of losing the console.
 *
 * Copy rules live in src/lib/error-copy.ts; the raw error message is not printed in production.
 * Do not auto-send.
 */
import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "cn";
import { errorCopy } from "@/lib/error-copy";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const copy = errorCopy({
    message: error.message,
    digest: error.digest,
    production: process.env.NODE_ENV === "production",
  });

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 md:px-6" data-workspace-error>
      <Alert variant="destructive">
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p>{copy.detail}</p>
          {copy.reference ? (
            <p className="mt-2 font-mono text-xs" data-error-reference>
              {copy.reference}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={reset}>
          Try again
        </Button>
        <Link href="/mychef/inbox" className={cn(buttonVariants({ variant: "ghost" }), "w-fit")}>
          Back to the inbox
        </Link>
      </div>
    </div>
  );
}
