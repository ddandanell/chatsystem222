"use client";
/**
 * Global error boundary: the root layout itself failed, so there is no shell, no nav and no theme
 * provider to lean on. Next.js requires this file to render its own <html> and <body>.
 *
 * It deliberately uses plain markup and inline styles only: if the layout is what broke, importing
 * the design system here is how a second failure hides the first. It still says nothing was sent.
 * Do not auto-send.
 */
import { useEffect } from "react";
import { errorCopy } from "@/lib/error-copy";

export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f7f6",
          color: "#1c1c1a",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ width: "100%", maxWidth: "480px" }} data-global-error>
          <h1 style={{ fontSize: "18px", fontWeight: 500, margin: "0 0 8px" }}>{copy.title}</h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, margin: "0 0 12px" }}>{copy.detail}</p>
          {copy.reference ? (
            <p style={{ fontSize: "12px", margin: "0 0 16px" }} data-error-reference>
              {copy.reference}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              fontSize: "14px",
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid #c9c9c4",
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
