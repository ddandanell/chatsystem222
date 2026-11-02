/**
 * Console sections, grouped so the shell can show a menu instead of one flowing row.
 * Settings is its own group. History is the decided queue, where a past thread stays readable.
 * Menus sit with the library. Do not auto-send.
 */

export type ConsoleLink = {
  label: string;
  href: (slug: string) => string;
};

export type ConsoleGroup = {
  id: "desk" | "library" | "settings";
  label: string;
  links: ConsoleLink[];
};

export const CONSOLE_GROUPS: ConsoleGroup[] = [
  {
    id: "desk",
    label: "Desk",
    links: [
      { label: "Inbox", href: (slug) => `/${slug}/inbox` },
      { label: "History", href: (slug) => `/${slug}/inbox?filter=decided` },
      { label: "Dashboard", href: (slug) => `/${slug}/dashboard` },
    ],
  },
  {
    id: "library",
    label: "Library",
    links: [
      { label: "Knowledge", href: (slug) => `/${slug}/knowledge` },
      { label: "Menus", href: (slug) => `/${slug}/menus` },
      { label: "Learning", href: (slug) => `/${slug}/candidates` },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    links: [
      { label: "Keys", href: (slug) => `/${slug}/settings/keys` },
      { label: "Access", href: (slug) => `/${slug}/settings/access` },
      { label: "Team", href: (slug) => `/${slug}/team` },
      { label: "Auto-pilot", href: (slug) => `/${slug}/settings/autopilot` },
      { label: "Webhooks", href: (slug) => `/${slug}/settings/webhooks` },
      { label: "Audit", href: (slug) => `/${slug}/audit` },
      { label: "Evals", href: (slug) => `/${slug}/evals` },
      { label: "Import", href: (slug) => `/${slug}/import` },
    ],
  },
];

export function isHistoryHref(pathname: string, filter: string | null): boolean {
  return pathname.includes("/inbox") && filter === "decided";
}

export function linkIsActive(pathname: string, href: string, filter: string | null): boolean {
  if (href.includes("filter=decided")) return isHistoryHref(pathname, filter);
  if (href.endsWith("/inbox")) return pathname.includes("/inbox") && filter !== "decided";
  return pathname === href || pathname.startsWith(`${href}/`);
}
