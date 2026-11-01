"use client";
/**
 * Workspace nav, including Keys and Auto-pilot. Do not auto-send.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";

const LINKS = [
  { label: "Dashboard", href: (slug: string) => `/${slug}/dashboard` },
  { label: "Inbox", href: (slug: string) => `/${slug}/inbox` },
  { label: "Import", href: (slug: string) => `/${slug}/import` },
  { label: "Knowledge", href: (slug: string) => `/${slug}/knowledge` },
  { label: "Keys", href: (slug: string) => `/${slug}/settings/keys` },
  { label: "Webhooks", href: (slug: string) => `/${slug}/settings/webhooks` },
  { label: "Auto-pilot", href: (slug: string) => `/${slug}/settings/autopilot` },
  { label: "Access", href: (slug: string) => `/${slug}/settings/access` },
  { label: "Learning", href: (slug: string) => `/${slug}/candidates` },
  { label: "Evals", href: (slug: string) => `/${slug}/evals` },
  { label: "Team", href: (slug: string) => `/${slug}/team` },
  { label: "Audit", href: (slug: string) => `/${slug}/audit` },
];

export function ConsoleNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1">
      {LINKS.map((link) => {
        const href = link.href(slug);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={link.label}
            href={href}
            className={cn(
              buttonVariants({
                variant: active ? "default" : "ghost",
                size: "sm",
              }),
            )}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
