/**
 * Knowledge list grouped for private-chef work. Do not auto-send.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { addPosition, listStoredKnowledge } from "@/data/mychef-store";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { KNOWLEDGE_FILTER_GROUPS, KNOWLEDGE_GROUPS, isKnowledgeGroup, isKnowledgeGroupFilter } from "@/lib/knowledge-groups";
import { listKnowledge } from "@/lib/knowledge";
import { listOrgDocuments, type WorkspaceDocument } from "@/lib/workspace-documents";

export const metadata = { title: "Knowledge" };

export default async function KnowledgePage({
  params,
  searchParams,
}: PageProps<"/[workspace]/knowledge">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  if (usesMychefInbox()) {
    const query = await searchParams;
    const group = typeof query.group === "string" ? query.group : "";
    return <MychefKnowledge slug={access.ctx.orgSlug} group={group} />;
  }
  const stored = await listOrgDocuments(access.ctx.orgId);
  const docs = stored.length > 0 ? stored : fileDocuments();
  const positions = docs.filter((doc) => doc.kind === "position");
  const playbooks = docs.filter((doc) => doc.kind === "playbook");
  const decisions = docs.filter((doc) => doc.kind === "decision");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-medium tracking-tight">Knowledge</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {stored.length > 0
            ? "Positions and playbooks stored for this workspace. Retrieval uses these documents."
            : "Positions say what is true. Playbooks say how to decide. Both are markdown in the repo until they are stored for this workspace."}
        </p>
      </div>
      <KnowledgeSection
        title="Positions"
        docs={positions}
        slug={access.ctx.orgSlug}
        empty="No positions in this workspace."
      />
      <KnowledgeSection
        title="Playbooks"
        docs={playbooks}
        slug={access.ctx.orgSlug}
        empty="No playbooks in this workspace."
      />
      {decisions.length > 0 ? (
        <KnowledgeSection
          title="Past decisions"
          docs={decisions}
          slug={access.ctx.orgSlug}
          empty=""
        />
      ) : null}
    </div>
  );
}

async function addPositionAction(formData: FormData) {
  "use server";
  const access = await getWorkspaceAccess("mychef");
  if (access.status !== "ok") return;
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const group = String(formData.get("group") ?? "");
  if (!title || !body || !isKnowledgeGroup(group)) return;
  const id = await addPosition({ title, body, group });
  const { redirect } = await import("next/navigation");
  redirect(`/mychef/knowledge/${id}`);
}

async function MychefKnowledge({ slug, group }: { slug: string; group: string }) {
  const docs = await listStoredKnowledge();
  const filtered = isKnowledgeGroupFilter(group) ? docs.filter((doc) => doc.group === group) : docs;
  const positions = filtered.filter((doc) => doc.kind === "position");
  const playbooks = filtered.filter((doc) => doc.kind === "playbook");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-medium tracking-tight">Knowledge</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          These are the existing knowledge rows for myCHEF. Groups are a reading filter. The source rows stay where they are.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/${slug}/knowledge`} className={buttonVariants({ variant: group ? "ghost" : "secondary", size: "sm" })}>
          All
        </Link>
        {KNOWLEDGE_FILTER_GROUPS.map((item) => (
          <Link
            key={item.id}
            href={`/${slug}/knowledge?group=${item.id}`}
            className={buttonVariants({ variant: group === item.id ? "secondary" : "ghost", size: "sm" })}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <KnowledgeSection title="Positions" docs={positions.map(asCard)} slug={slug} empty="No positions in this group." />
      <KnowledgeSection title="Playbooks" docs={playbooks.map(asCard)} slug={slug} empty="No playbooks in this group." />
      <form action={addPositionAction} className="flex max-w-xl flex-col gap-3 rounded-xl border p-4">
        <h3 className="text-sm font-medium">Add a position</h3>
        <input name="title" required placeholder="Title" className="h-9 rounded-md border bg-background px-3 text-sm" />
        <textarea name="body" required rows={5} placeholder="What is true" className="rounded-md border bg-background px-3 py-2 text-sm" />
        <select name="group" className="h-9 rounded-md border bg-background px-3 text-sm">
          {KNOWLEDGE_GROUPS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonVariants({ variant: "default" })}>
          Save position
        </button>
      </form>
    </div>
  );
}

function asCard(doc: { id: string; title: string; kind: WorkspaceDocument["kind"]; group: string }): WorkspaceDocument {
  return { id: doc.id, title: doc.title, kind: doc.kind, sourceId: doc.group };
}

function fileDocuments(): WorkspaceDocument[] {
  return listKnowledge().map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    sourceId: doc.id,
    title: doc.title,
  }));
}

function KnowledgeSection({
  title,
  docs,
  slug,
  empty,
}: {
  title: string;
  docs: WorkspaceDocument[];
  slug: string;
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {docs.map((doc) => (
            <li key={doc.id}>
              <Link href={`/${slug}/knowledge/${doc.id}`} className="block">
                <Card>
                  <CardHeader>
                    <Badge variant="outline">
                      {doc.kind === "playbook"
                        ? "Playbook"
                        : doc.kind === "decision"
                          ? "Decision"
                          : "Position"}
                    </Badge>
                    <CardTitle>{doc.title}</CardTitle>
                    <CardDescription>{doc.sourceId}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
