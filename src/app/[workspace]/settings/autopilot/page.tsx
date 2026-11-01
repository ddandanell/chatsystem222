/**
 * Auto-pilot settings. Default off at /settings/autopilot. Do not auto-send.
 */
import { saveAutopilotAction } from "@/app/[workspace]/settings/autopilot/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getWorkspaceAccess } from "@/lib/context";
import { readAutopilot } from "@/lib/autopilot";
import { canManageKeys } from "@/lib/workspace-access";

export const metadata = { title: "Auto-pilot" };
export const instant = false;

export default async function AutopilotPage({
  params,
  searchParams,
}: PageProps<"/[workspace]/settings/autopilot">) {
  const { workspace } = await params;
  const query = await searchParams;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const settings = await readAutopilot();
  const manage = canManageKeys(access.ctx.role);
  const error = typeof query.error === "string" ? query.error : "";
  const saved = query.saved === "1";

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Auto-pilot</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The switch starts off. While it is off, every draft stays pending. If you turn it on, a draft can be marked auto_sent_candidate only when its confidence is at least the threshold and it does not need a person. That mark does not send a message.
        </p>
      </div>
      {settings.enabled ? (
        <Alert>
          <AlertTitle>Sending is not connected.</AlertTitle>
          <AlertDescription>
            Auto-pilot can record a candidate. It cannot deliver the reply.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>Automatic sending is not on</AlertTitle>
          <AlertDescription>Every draft stays pending until a person reviews it.</AlertDescription>
        </Alert>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>
            {settings.enabled
              ? "Auto-pilot is on. Sending is not connected."
              : "Auto-pilot is off. Drafts stay pending."}
          </AlertDescription>
        </Alert>
      ) : null}
      <form action={saveAutopilotAction.bind(null, access.ctx.orgSlug)} className="flex flex-col gap-4 rounded-xl border p-4">
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch
              id="autopilot-enabled"
              name="enabled"
              value="on"
              defaultChecked={settings.enabled === true}
              disabled={!manage}
            />
            <FieldLabel htmlFor="autopilot-enabled">Auto-pilot</FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="autopilot-threshold">Confidence threshold</FieldLabel>
            <Input
              id="autopilot-threshold"
              name="threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={settings.confidenceThreshold}
              required
              disabled={!manage}
            />
          </Field>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">
          Stored for myCHEF on its own connection row. Provider keys are not changed. Saving with the switch off keeps sending disconnected.
        </p>
        {manage ? <Button type="submit" className="w-fit">Save auto-pilot</Button> : null}
      </form>
    </div>
  );
}
