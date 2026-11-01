"use client";
/**
 * Inbox route error boundary: the desk failed but the shell survives, so the operator can go back to
 * a working queue instead of staring at a blank console.
 *
 * Copy rules live in src/lib/error-copy.ts; the raw error message is not printed in production.
 * Do not auto-send.
 */
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { errorCopy } from "@/lib/error-copy";

export default function InboxError({
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
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6"
      data-inbox-error
    >
      <Alert variant="destructive" className="max-w-md">
        <AlertTriangleIcon />
        <AlertTitle>Inbox could not load</AlertTitle>
        <AlertDescription>
          <p>{copy.detail}</p>
          {copy.reference ? (
            <p className="mt-2 font-mono text-xs" data-error-reference>
              {copy.reference}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={reset}>
          Try again
        </Button>
        <Link href="/mychef/dashboard" className={cn(buttonVariants({ variant: "ghost" }), "w-fit")}>
          Open the dashboard instead
        </Link>
      </div>
    </div>
  );
}
