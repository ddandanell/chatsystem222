/**
 * Provider keys at /settings/keys. Hint only. Do not auto-send.
 */
import { KeyManager } from "@/components/key-manager";
import { NEON_AUTH_URL, NEON_JWKS_URL } from "@/lib/neon-auth";
import { getWorkspaceAccess } from "@/lib/context";
import { listCredentials } from "@/lib/credentials";
import type { Provider } from "@/lib/providers";
import { canManageKeys } from "@/lib/workspace-access";
import {
  revokeKeyAction,
  rotateKeyAction,
  saveKeyAction,
  testKeyAction,
} from "@/app/[workspace]/settings/keys/actions";

export const metadata = { title: "Keys" };

export default async function KeysPage({
  params,
}: PageProps<"/[workspace]/settings/keys">) {
  const { workspace } = await params;
  const access = await getWorkspaceAccess(workspace);
  if (access.status !== "ok") return null;
  const rows = await listCredentials(access.ctx.orgId);
  const slug = access.ctx.orgSlug;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium tracking-tight">Provider keys</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Start with Vercel AI Gateway and DeepSeek. Keys are encrypted with
          the server master key and decrypted only for a request. The page
          shows a four-character hint after save. Gateway defaults to
          https://ai-gateway.vercel.sh/v1. DeepSeek uses
          https://api.deepseek.com. Azure and Bedrock tests do not send the key.
        </p>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Neon Auth is the identity endpoint {NEON_AUTH_URL}. JWKS is {NEON_JWKS_URL}. Neither is a database connection string.
        </p>
      </div>
      <KeyManager
        canManage={canManageKeys(access.ctx.role)}
        rows={rows.map((row) => ({
          id: row.id,
          provider: row.provider as Provider,
          keyHint: row.keyHint,
          baseUrl: row.baseUrl,
          isActive: row.isActive,
          createdAt: row.createdAt.toISOString(),
          rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
          verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
          lastError: row.lastError,
        }))}
        saveAction={saveKeyAction.bind(null, slug)}
        rotateAction={rotateKeyAction.bind(null, slug)}
        revokeAction={revokeKeyAction.bind(null, slug)}
        testAction={testKeyAction.bind(null, slug)}
      />
    </div>
  );
}
