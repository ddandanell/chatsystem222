"use client";

/**
 * Phone navigation: four primary destinations plus a sheet for the rest.
 * Purpose: replace the 13-chip wrapping row that left 28px tap targets on mobile.
 * Desktop uses the grouped sidebar; this bar is lg:hidden.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BookOpenIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MenuIcon,
  SparklesIcon,
} from "lucide-react";
import { CONSOLE_GROUPS, linkIsActive } from "@/lib/console-links";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "cn";

const PRIMARY = [
  { label: "Dashboard", href: (slug: string) => `/${slug}/dashboard`, Icon: LayoutDashboardIcon },
  { label: "Inbox", href: (slug: string) => `/${slug}/inbox`, Icon: InboxIcon },
  { label: "Knowledge", href: (slug: string) => `/${slug}/knowledge`, Icon: BookOpenIcon },
  { label: "Learning", href: (slug: string) => `/${slug}/candidates`, Icon: SparklesIcon },
];

export function MobileNav({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";
  const filter = useSearchParams().get("filter");
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return linkIsActive(pathname, href, filter);
  }

  return (
    <nav
      aria-label="Console sections"
      data-testid="mobile-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY.map((item) => {
          const href = item.href(slug);
          const active = isActive(href);
          return (
            <li key={item.label}>
              <Link
                href={href}
                data-tap
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.68rem] leading-none",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <item.Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            data-tap
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[0.68rem] leading-none text-muted-foreground"
          >
            <MenuIcon className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle>All sections</SheetTitle>
            <SheetDescription>
              Every console page. Sending stays off on all of them.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 pb-4">
            {CONSOLE_GROUPS.map((group) => (
              <div key={group.id} className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                <ul className="grid grid-cols-2 gap-2">
                  {group.links.map((item) => {
                    const href = item.href(slug);
                    const active = isActive(href);
                    return (
                      <li key={item.label}>
                        <Link
                          href={href}
                          data-tap
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 items-center rounded-lg border border-border px-3 text-sm",
                            active ? "bg-secondary text-secondary-foreground" : "bg-background",
                          )}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
