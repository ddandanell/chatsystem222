/**
 * One list of console sections, shared by the desktop nav and the phone sheet.
 * Do not auto-send.
 */

export type ConsoleLink = {
  label: string;
  href: (slug: string) => string;
};

export const CONSOLE_LINKS: ConsoleLink[] = [
  { label: "Dashboard", href: (slug) => `/${slug}/dashboard` },
  { label: "Inbox", href: (slug) => `/${slug}/inbox` },
  { label: "Import", href: (slug) => `/${slug}/import` },
  { label: "Knowledge", href: (slug) => `/${slug}/knowledge` },
  { label: "Menus", href: (slug) => `/${slug}/menus` },
  { label: "Keys", href: (slug) => `/${slug}/settings/keys` },
  { label: "Webhooks", href: (slug) => `/${slug}/settings/webhooks` },
  { label: "Auto-pilot", href: (slug) => `/${slug}/settings/autopilot` },
  { label: "Access", href: (slug) => `/${slug}/settings/access` },
  { label: "Learning", href: (slug) => `/${slug}/candidates` },
  { label: "Evals", href: (slug) => `/${slug}/evals` },
  { label: "Team", href: (slug) => `/${slug}/team` },
  { label: "Audit", href: (slug) => `/${slug}/audit` },
];
