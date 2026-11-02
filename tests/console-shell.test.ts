/**
 * The console is a menu, not one flowing row of every section.
 * History is its own place, and a recorded conversation keeps the thread.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONSOLE_GROUPS, linkIsActive } from "@/lib/console-links";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("desk, library, and settings are separate groups", () => {
  assert.deepEqual(
    CONSOLE_GROUPS.map((group) => group.id),
    ["desk", "library", "settings"],
  );
  const settings = CONSOLE_GROUPS.find((group) => group.id === "settings");
  assert.ok(settings);
  assert.deepEqual(
    settings.links.map((link) => link.label),
    ["Keys", "Access", "Team", "Auto-pilot", "Webhooks", "Audit", "Evals", "Import"],
  );
});

test("history is the decided queue, and it does not also light up Inbox", () => {
  const history = CONSOLE_GROUPS.flatMap((group) => group.links).find((link) => link.label === "History");
  const inbox = CONSOLE_GROUPS.flatMap((group) => group.links).find((link) => link.label === "Inbox");
  assert.equal(history?.href("mychef"), "/mychef/inbox?filter=decided");
  assert.equal(inbox?.href("mychef"), "/mychef/inbox");
  assert.equal(linkIsActive("/mychef/inbox", history!.href("mychef"), "decided"), true);
  assert.equal(linkIsActive("/mychef/inbox/abc", history!.href("mychef"), "decided"), true);
  assert.equal(linkIsActive("/mychef/inbox", inbox!.href("mychef"), "decided"), false);
  assert.equal(linkIsActive("/mychef/inbox", inbox!.href("mychef"), null), true);
  assert.equal(linkIsActive("/mychef/settings/keys", history!.href("mychef"), null), false);
});

test("the shell renders the sidebar menu and the phone sheet uses the same groups", () => {
  const layout = read("src/app/[workspace]/layout.tsx");
  const sidebar = read("src/components/console-sidebar.tsx");
  const mobile = read("src/components/mobile-nav.tsx");
  assert.match(layout, /ConsoleSidebar/);
  assert.doesNotMatch(layout, /ConsoleNav/);
  assert.match(sidebar, /aria-controls="console-settings-menu"/);
  assert.match(sidebar, /CONSOLE_GROUPS/);
  assert.match(mobile, /CONSOLE_GROUPS/);
});

test("a recorded conversation renders the thread, not a replacement summary", () => {
  const desk = read("src/app/[workspace]/inbox/desk.tsx");
  const history = read("src/components/inbox/thread-history.tsx");
  assert.match(desk, /<ThreadHistory/);
  assert.doesNotMatch(desk, /Already recorded/);
  assert.match(history, /data-slot="thread-history"/);
  assert.match(history, /Recorded decision/);
  assert.match(history, /filter=decided/);
});
