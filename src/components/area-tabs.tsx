"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { groupSections, sectionFor } from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface AreaTabsArea {
  key: string;
  title: string;
  sections: Array<{ href: string; label: string; group: string; also?: string[] }>;
}

/**
 * The two rows of tabs across the top of every page of an area (Payroll and so on): the jobs, then the pages of the job you are on. Only the pages the person may open are passed in, so
 * nothing here grants access; every page still checks permission and module on the server. Shown only on a page that belongs to an area.
 */
export function AreaTabs({ areas }: { areas: AreaTabsArea[] }) {
  const pathname = usePathname();
  for (const area of areas) {
    const here = sectionFor(area, pathname);
    if (!here) continue;
    const groups = groupSections(area.sections);
    const active = groups.find((g) => g.group === here.group) ?? groups[0];
    const tab = (on: boolean) => cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", on ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground");
    return (
      <div className="no-print mb-4">
        <nav aria-label={`${area.title} jobs`} className="flex gap-1 overflow-x-auto border-b">
          {groups.map((g) => (
            <Link key={g.group} href={g.sections[0].href} aria-current={g === active ? "true" : undefined} className={cn(tab(g === active), "font-medium")}>
              {g.group}
            </Link>
          ))}
        </nav>
        {active.sections.length > 1 && (
          <nav aria-label={`${area.title}: ${active.group}`} className="flex gap-1 overflow-x-auto bg-muted/40 px-1">
            {active.sections.map((s) => (
              <Link key={s.href} href={s.href} aria-current={s.href === here.href ? "page" : undefined} className={tab(s.href === here.href)}>
                {s.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    );
  }
  return null;
}
