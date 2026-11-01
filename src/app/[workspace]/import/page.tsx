/**
 * Import screen. Raw files under data/raw. Does not overwrite the 12 knowledge rows. Do not auto-send.
 */
import { curateArchiveAction, importArchiveAction } from "@/app/[workspace]/import/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { usesMychefInbox } from "@/db/mode";
import { getWorkspaceAccess } from "@/lib/context";
import { listArchives } from "@/lib/raw-archive";
import { canReview } from "@/lib/workspace-access";

export const metadata = { title: "Import" };
export const instant = false;

function storedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export default async function ImportPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/import">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const archives = await listArchives();
  const slug = access.ctx.orgSlug;
  const review = canReview(access.ctx.role);
  const curate = curateArchiveAction.bind(null, slug);
  const stored = typeof query.stored === "string" ? query.stored : "";
  const fileCount = typeof query.files === "string" ? query.files : "";
  const error = typeof query.error === "string" ? query.error : "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Import</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          ChatGPT project exports stay as raw files for myCHEF. There is no archive table that can hold the bytes, so they are kept in this app’s local raw store. Approving one archive inserts a new pending knowledge row. The rows already in knowledge are left as they are. Automatic sending is not on.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Not stored</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {stored ? (
        <Alert>
          <AlertTitle>Stored</AlertTitle>
          <AlertDescription>
            Stored {stored} as a raw archive{fileCount ? ` (${fileCount} files)` : ""}. Knowledge was not changed.
          </AlertDescription>
        </Alert>
      ) : null}
      {review ? (
        <form action={importArchiveAction} className="flex max-w-xl flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">ChatGPT project export</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Zip, JSON, or Markdown. The file is stored as a raw archive for this workspace. Knowledge is not changed.
            </p>
          </div>
          <input type="hidden" name="slug" value={slug} />
          <Input
            name="file"
            type="file"
            accept=".zip,.json,.md,.markdown,.txt,application/zip,application/json,text/markdown,text/plain"
            required
          />
          <Button type="submit">Store archive</Button>
        </form>
      ) : null}
      {archives.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No archives yet</EmptyTitle>
            <EmptyDescription>
              Upload a zip, JSON, or Markdown export. Nothing is copied into knowledge until you approve it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {archives.map((archive) => (
            <li key={archive.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{archive.filename}</p>
                <Badge variant="secondary">{archive.files.length} files</Badge>
                <Badge variant="outline">{Math.max(1, Math.round(archive.bytes / 1024))} KB</Badge>
                {archive.knowledgeId ? <Badge>Pending knowledge</Badge> : <Badge variant="outline">Raw only</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                Stored {storedLabel(archive.storedAt)}
                {archive.knowledgeId ? ` · ${archive.knowledgeId}` : ""}
              </p>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {archive.files.slice(0, 8).map((file) => (
                  <li key={file.name}>
                    {file.name}
                    {file.text ? "" : " · skipped, not text"}
                  </li>
                ))}
              </ul>
              {review && usesMychefInbox() && !archive.knowledgeId && archive.files.some((file) => file.text) ? (
                <form action={curate}>
                  <input type="hidden" name="id" value={archive.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Approve into knowledge
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
