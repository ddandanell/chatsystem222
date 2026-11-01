/**
 * Channel adapters for inbound client messages.
 * Purpose: keep GHL, WhatsApp Business, and manual intake as pluggable kinds
 * so the desk stays channel-agnostic. WhatsApp is not implemented yet — only
 * reserved here so future wiring does not fork the inbox.
 * Docs: documentation/handoff.md, documentation/architecture.md.
 * Do not auto-send on any channel.
 */

export const CHANNEL_KINDS = [
  { id: "ghl", label: "GoHighLevel", status: "receive_stub" as const },
  { id: "whatsapp_business", label: "WhatsApp Business", status: "planned" as const },
  { id: "manual", label: "Manual", status: "active" as const },
] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number]["id"];

export function isChannelKind(value: string): value is ChannelKind {
  return CHANNEL_KINDS.some((channel) => channel.id === value);
}

/**
 * Display label for a stored channel value.
 *
 * Stored rows are not perfectly normalised: the inbound adapter writes `ghl`, older rows and
 * hand-entered data can carry `whatsapp`, and the reserved kind is `whatsapp_business`. Without
 * normalisation the desk showed a raw `whatsapp` where it should say WhatsApp Business, and a
 * capitalised or padded value fell through to the raw string.
 */
export function channelLabel(value: string | null | undefined): string {
  if (!value) return "Channel";
  const normalized = value.trim().toLowerCase();
  if (normalized === "whatsapp" || normalized === "whatsapp_business") {
    return "WhatsApp Business";
  }
  const hit = CHANNEL_KINDS.find((channel) => channel.id === normalized);
  return hit?.label ?? value.trim();
}
