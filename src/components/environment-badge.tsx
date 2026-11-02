/**
 * Deployment identity chip: PROD / PREVIEW / LOCAL, the deployment id and the commit. MC-003 · UX-0224.
 *
 * Purpose: a release record named one deployment while the live host served another, and no page
 * said which. This chip is server-rendered from this process's own environment, so what an operator
 * reads is what the host reported — not a value a human typed into a document.
 *
 * Render it in the console shell and on the sign-in page: the sign-in page is where the mismatch was
 * first seen. The values are public build metadata (no secret, no key, no address).
 *
 * UX-0224: at 390px the full line (`PROD · dpl_… · f4f3a28`, 52 characters of 11px mono) is 328px
 * wide, so it cannot share a line with the workspace name and the header grew to 177px on every
 * workspace route. Below `sm` the chip trades the deployment id for the commit — `PROD · f4f3a28` —
 * which is the part an operator quotes. Nothing is lost: `data-deployment-id` and `data-commit` stay
 * on the element (the live-marker check reads them) and the full line is still the `title` and still
 * what renders from `sm` up.
 *
 * Do not auto-send.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { currentDeploymentInfo, deploymentLine, deploymentLineCompact } from "@/lib/deployment-info";

export function EnvironmentBadge({ className }: { className?: string }) {
  const info = currentDeploymentInfo();
  const attention = info.environment !== "production";

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[0.6875rem] tracking-tight",
        attention ? "border-destructive/40 text-destructive" : "text-muted-foreground",
        className,
      )}
      data-environment={info.environment}
      data-deployment-id={info.deploymentId ?? "none"}
      data-commit={info.commitSha ?? "none"}
      title={`${info.detail} Deployment ${info.deploymentId ?? "not reported"}, commit ${info.commitSha ?? "not reported"}${info.commitRef ? ` on ${info.commitRef}` : ""}.`}
    >
      <span className="hidden sm:inline" data-slot="deployment-full">
        {deploymentLine(info)}
      </span>
      <span className="sm:hidden" data-slot="deployment-compact">
        {deploymentLineCompact(info)}
      </span>
    </Badge>
  );
}
