"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { employeesSectionActive, showEmployeesSections } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** The row of tabs across the top of the Employees pages (Import employees, Bank information and the rest). The layout decides which the person may see; this marks the one they are on. */
export function EmployeesSections({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  if (!showEmployeesSections(pathname) || items.length < 2) return null;
  return (
    <nav aria-label="Employees" className="no-print mb-4 flex gap-1 overflow-x-auto border-b">
      {items.map((s) => {
        const active = employeesSectionActive(s.href, pathname);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
