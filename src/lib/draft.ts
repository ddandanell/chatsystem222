/**
 * Local structured draft. Quotes knowledge. Does not call a provider. Do not auto-send.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { chunks, decisionRecords, documents, providerCredentials, rawMessages } from "@/db/schema";
import type { SourceRef } from "@/db/schema";
import { withTenant, type AppTx } from "@/db/tenant";
import { chunkBody, embedText, tokenize } from "@/lib/embed";
import { retrieveWithin, type RetrievedItem } from "@/lib/retrieval";
import { composeLocalReply, type ThreadMessage } from "@/lib/thread-memory";

const ESCALATE =
  /\b(lawyer|attorney|sue|suing|chargeback|health department|food poisoning|food safety|press|journalist|custom contract)\b/i;

export type StructuredDraft = {
  draftText: string;
  why: string;
  whyNot: string;
  confidence: number;
  sourceRefs: SourceRef[];
  escalate: boolean;
};

export function assertProviderCallAllowed(hasStoredKey: boolean, calling: boolean) {
  if (calling && !hasStoredKey) {
    throw new Error("Refusing to call a provider without a stored key.");
  }
}

function sharesToken(query: Set<string>, token: string): boolean {
  if (query.has(token)) return true;
  if (token.length < 5) return false;
  for (const word of query) {
    if (word.length < 5) continue;
    if (word.startsWith(token) || token.startsWith(word)) return true;
  }
  return false;
}

function lexicalScore(inbound: string, item: RetrievedItem): number {
  const query = new Set(tokenize(inbound));
  if (query.size === 0) return 0;
  const titleHits = new Set(tokenize(item.title).filter((token) => sharesToken(query, token))).size;
  const seen = new Set<string>();
  let bodyHits = 0;
  for (const token of tokenize(item.excerpt)) {
    if (seen.has(token) || !sharesToken(query, token)) continue;
    seen.add(token);
    bodyHits += 1;
  }
  return (titleHits * 3 + bodyHits) / query.size;
}

/**
 * MC-168/169/170: the text a reviewer sees is a real reply, not the old placeholder line
 * ("This draft was not produced by a provider.") followed by a quote. Provenance still says the
 * local path wrote it — model='local' in the row, the notice in the panel, the "not produced by a
 * provider" caption in the thread view — but the words in the box are ones a guest could receive.
 * `thread` is the whole conversation; when it is passed, the reply is grounded on all of it.
 */
export function localStructuredDraft(
  inbound: string,
  knowledge: RetrievedItem[],
  decisions: RetrievedItem[],
  thread?: ThreadMessage[],
): StructuredDraft {
  const position = knowledge
    .filter((item) => item.kind === "position")
    .map((item) => ({ item, rank: lexicalScore(inbound, item) * 2 + item.score }))
    .sort((left, right) => right.rank - left.rank)[0]?.item;
  const similar = decisions[0];
  const escalate = !position || position.score < 0.22 || ESCALATE.test(inbound);
  const messages: ThreadMessage[] =
    thread && thread.length > 0 ? thread : [{ direction: "inbound", body: inbound }];
  const ordered = position
    ? [position, ...knowledge.filter((item) => item.sourceId !== position.sourceId)]
    : knowledge;
  const composed = composeLocalReply(
    ordered.map((item) => ({ title: item.title, kind: item.kind, excerpt: item.excerpt })),
    messages,
  );
  const draftText = composed.text;
  const why = position
    ? `The closest position in this workspace is “${position.title}”. ${composed.why}`
    : composed.why;
  const whyNot = similar
    ? `The closest past decision in this workspace is “${similar.title}”. This draft does not copy that reply. It follows the position.`
    : "No similar past decision in this workspace was close enough to copy.";
  const rawScore = position ? position.score : 0.2;
  const confidence = Math.round(Math.min(0.9, Math.max(0.15, escalate ? Math.min(rawScore, 0.45) : rawScore)) * 100) / 100;
  const sourceRefs: SourceRef[] = [];
  const orderedKnowledge = position
    ? [position, ...knowledge.filter((item) => item.sourceId !== position.sourceId)]
    : knowledge;
  for (const item of orderedKnowledge) {
    if (item.kind !== "position" && item.kind !== "playbook") continue;
    if (sourceRefs.some((ref) => ref.id === item.sourceId)) continue;
    sourceRefs.push({ id: item.sourceId, title: item.title, kind: item.kind });
    if (sourceRefs.length === 3) break;
  }
  return { draftText, why, whyNot, confidence, sourceRefs, escalate };
}

async function indexDecision(
  tx: AppTx,
  orgId: string,
  decisionId: string,
  inbound: string,
  draftText: string,
) {
  const title = inbound.replace(/\s+/g, " ").trim().slice(0, 80) || "Past decision";
  const body = `${inbound.trim()}\n\nDraft\n${draftText.trim()}`;
  const inserted = await tx
    .insert(documents)
    .values({
      orgId,
      kind: "decision",
      sourceId: decisionId,
      title,
      body,
    })
    .returning({ id: documents.id });
  const documentId = inserted[0]?.id;
  if (!documentId) throw new Error("decision document was not stored");
  const pieces = chunkBody(title, body);
  for (let ordinal = 0; ordinal < pieces.length; ordinal += 1) {
    const piece = pieces[ordinal] ?? body;
    await tx.insert(chunks).values({
      orgId,
      documentId,
      ordinal,
      body: piece,
      embedding: embedText(piece),
    });
  }
}

export async function createDraft(
  orgId: string,
  inbound: string,
): Promise<{ ok: true; id: string; draft: StructuredDraft } | { ok: false; error: string }> {
  const text = inbound.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "Paste the client message." };
  if (text.length > 4000) {
    return { ok: false, error: "Paste one message, up to 4000 characters." };
  }

  return withTenant(orgId, async (tx) => {
    const keys = await tx
      .select({ id: providerCredentials.id })
      .from(providerCredentials)
      .where(eq(providerCredentials.isActive, true))
      .limit(1);
    // calling is false: this path never requests a completion and never sends.
    assertProviderCallAllowed(keys.length > 0, false);

    const retrieved = await retrieveWithin(tx, orgId, text, undefined, 8);
    const draft = localStructuredDraft(text, retrieved.knowledge, retrieved.decisions);
    const conversationId = randomUUID();
    const message = await tx
      .insert(rawMessages)
      .values({
        orgId,
        conversationId,
        body: text,
        channel: "manual",
      })
      .returning({ id: rawMessages.id });
    const inboundMessageId = message[0]?.id;
    if (!inboundMessageId) throw new Error("inbound message was not stored");
    const row = await tx
      .insert(decisionRecords)
      .values({
        orgId,
        conversationId,
        inboundMessageId,
        draftText: draft.draftText,
        rationale: draft.why,
        whyNot: draft.whyNot,
        confidence: draft.confidence.toFixed(2),
        sourceRefs: draft.sourceRefs,
        actionTaken: draft.escalate ? "escalate" : "reply",
        status: "pending_review",
      })
      .returning({ id: decisionRecords.id });
    const id = row[0]?.id;
    if (!id) throw new Error("decision was not stored");
    await indexDecision(tx, orgId, id, text, draft.draftText);
    return { ok: true as const, id, draft };
  });
}
