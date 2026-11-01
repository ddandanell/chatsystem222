"use client";
/**
 * Desktop workspace nav. Phones use MobileNav (bottom bar + sheet).
 * Purpose: keep every section reachable; 12 links are too many for a phone header.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { CONSOLE_LINKS } from "@/lib/console-links";
import { cn } from "cn";

export function ConsoleNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Console sections" className="hidden gap-1 overflow-x-auto pb-1 lg:flex">
      {CONSOLE_LINKS.map((link) => {
        const href = link.href(slug);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={link.label}
            href={href}
            data-tap
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
