/**
 * Channel label tests. Pure function: no database, no network, no provider call.
 *
 * The desk shows this label next to a conversation. A raw `whatsapp` or a padded value used to
 * reach the screen, which is how the three-pane branch's only still-missing change was found.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelLabel, isChannelKind, CHANNEL_KINDS } from "@/lib/channels";

test("known channel ids get their label", () => {
  assert.equal(channelLabel("ghl"), "GoHighLevel");
  assert.equal(channelLabel("manual"), "Manual");
  assert.equal(channelLabel("whatsapp_business"), "WhatsApp Business");
});

test("the whatsapp alias is labelled as WhatsApp Business, not echoed raw", () => {
  assert.equal(channelLabel("whatsapp"), "WhatsApp Business");
  assert.equal(channelLabel("WhatsApp"), "WhatsApp Business");
});

test("case and surrounding whitespace do not leak into the label", () => {
  assert.equal(channelLabel("  GHL "), "GoHighLevel");
});

test("an unknown channel keeps its raw value, and empty means Channel", () => {
  assert.equal(channelLabel("telegram"), "telegram");
  assert.equal(channelLabel(""), "Channel");
  assert.equal(channelLabel(null), "Channel");
  assert.equal(channelLabel(undefined), "Channel");
});

test("only reserved kinds are accepted as channel kinds", () => {
  assert.equal(isChannelKind("ghl"), true);
  assert.equal(isChannelKind("whatsapp"), false);
  assert.equal(isChannelKind("telegram"), false);
  assert.deepEqual(
    CHANNEL_KINDS.map((channel) => channel.id),
    ["ghl", "whatsapp_business", "manual"],
  );
});
