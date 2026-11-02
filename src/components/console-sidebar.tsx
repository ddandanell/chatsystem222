"use client";

/**
 * Desktop menu. Desk, library, and settings stay in separate groups so the
 * inbox is not topped by a row of every section. Settings starts closed
 * unless the current page is one of its links.
 * Do not auto-send.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { CONSOLE_GROUPS, linkIsActive } from "@/lib/console-links";
import { cn } from "cn";

export function ConsoleSidebar({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";
  const filter = useSearchParams().get("filter");
  const settingsHref = CONSOLE_GROUPS.find((group) => group.id === "settings")?.links ?? [];
  const inSettings = settingsHref.some((link) => linkIsActive(pathname, link.href(slug), filter));
  const [settingsOpened, setSettingsOpened] = useState(false);
  const settingsOpen = inSettings || settingsOpened;

  return (
    <aside
      data-slot="console-sidebar"
      className="hidden w-56 shrink-0 flex-col border-r border-border bg-muted/40 lg:flex"
    >
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-medium tracking-tight">Inbox mychef</p>
        <p className="mt-1 text-xs text-muted-foreground">Nothing sends from this console.</p>
      </div>
      <nav aria-label="Console sections" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
        {CONSOLE_GROUPS.map((group) => {
          if (group.id === "settings") {
            return (
              <div key={group.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  className="flex min-h-11 items-center justify-between rounded-md px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
                  aria-expanded={settingsOpen}
                  aria-controls="console-settings-menu"
                  onClick={() => setSettingsOpened((open) => !open)}
                >
                  {group.label}
                  <ChevronDownIcon
                    className={cn("size-4 transition-transform", settingsOpen ? "rotate-180" : null)}
                    aria-hidden
                  />
                </button>
                {settingsOpen ? (
                  <ul id="console-settings-menu" className="flex flex-col gap-1">
                    {group.links.map((link) => (
                      <li key={link.label}>
                        <SidebarLink
                          href={link.href(slug)}
                          label={link.label}
                          active={linkIsActive(pathname, link.href(slug), filter)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          }
          return (
            <div key={group.id} className="flex flex-col gap-1">
              <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              <ul className="flex flex-col gap-1">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <SidebarLink
                      href={link.href(slug)}
                      label={link.label}
                      active={linkIsActive(pathname, link.href(slug), filter)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function SidebarLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      data-tap
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-md px-2 text-sm",
        active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
