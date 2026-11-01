"use client";
/**
 * Root error boundary: a page outside the console shell (sign-in, password reset, workspace choice)
 * crashed. It keeps the visitor inside the product instead of dropping them on the framework's
 * default error screen, and it says the one thing that matters: nothing was sent.
 *
 * Copy rules live in src/lib/error-copy.ts so the "no internal message in production" rule is tested.
 * Do not auto-send.
 */
import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { errorCopy } from "@/lib/error-copy";

export default function RootError({
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
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-4 bg-muted/40 px-4 py-16">
      <Alert variant="destructive" className="w-full max-w-md">
        <AlertTriangleIcon />
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
        <Link href="/" className={cn(buttonVariants({ variant: "ghost" }), "w-fit")}>
          Back to the console
        </Link>
      </div>
    </main>
  );
}
