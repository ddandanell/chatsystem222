/**
 * One knowledge row. Table: knowledge or documents. Do not auto-send.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkdownBody } from "@/components/markdown-body";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { getStoredKnowledge } from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { getKnowledge } from "@/lib/knowledge";
import { getOrgDocument } from "@/lib/workspace-documents";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/[workspace]/knowledge/[id]">) {
  const { workspace, id } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (usesMychefInbox() && access.status === "ok") {
    const doc = await getStoredKnowledge(id);
    return { title: doc?.title ?? "Knowledge" };
  }
  if (access.status === "ok" && UUID.test(id)) {
    const stored = await getOrgDocument(access.ctx.orgId, id);
    if (stored) return { title: stored.title };
  }
  const doc = getKnowledge(id);
  return { title: doc?.title ?? "Knowledge" };
}

export default async function KnowledgeDocPage({
  params,
}: PageProps<"/[workspace]/knowledge/[id]">) {
  const { workspace, id } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  if (usesMychefInbox()) {
    const doc = await getStoredKnowledge(id);
    if (!doc) notFound();
    return (
      <article className="flex max-w-2xl flex-col gap-5">
        <Link
          href={`/${access.ctx.orgSlug}/knowledge`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
        >
          All knowledge
        </Link>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{doc.kind}</Badge>
            <Badge variant="outline">{doc.group}</Badge>
          </div>
          <h1 className="text-2xl font-medium tracking-tight">{doc.title}</h1>
        </div>
        <MarkdownBody source={doc.content} />
      </article>
    );
  }
  const stored = UUID.test(id) ? await getOrgDocument(access.ctx.orgId, id) : null;
  const file = stored ? undefined : getKnowledge(id);
  if (!stored && !file) notFound();

  const title = stored?.title ?? file?.title ?? "Knowledge";
  const body = stored?.body ?? file?.body ?? "";
  const kind = stored?.kind ?? file?.kind ?? "position";
  const source = stored?.sourceId ?? file?.scope ?? "";

  return (
    <article className="flex max-w-2xl flex-col gap-5">
      <Link
        href={`/${access.ctx.orgSlug}/knowledge`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-fit")}
      >
        All knowledge
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{kind}</Badge>
          {source ? <Badge variant="outline">{source}</Badge> : null}
          {file ? <Badge variant="outline">{file.priority}</Badge> : null}
        </div>
        <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
        {file ? (
          <p className="text-sm text-muted-foreground">
            {file.owner} · {file.status}
            {file.effectiveFrom ? ` · from ${file.effectiveFrom}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Stored for {access.ctx.orgName}. Retrieval uses this document.
          </p>
        )}
      </div>
      <MarkdownBody source={body} />
    </article>
  );
}
