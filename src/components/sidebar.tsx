"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Menu, Shield, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; section?: string };
type Group = { title: string; items: Item[] };

/** The group whose items contain the given path (used to auto-expand it). */
function groupFor(groups: Group[], path: string): string | null {
  for (const g of groups) {
    for (const i of g.items) {
      const base = i.href.split("?")[0];
      if (i.href === path || (base !== "/" && path.startsWith(base + "/")) || path === base) return g.title;
    }
  }
  return null;
}

function NavList({ groups, onNavigate }: { groups: Group[]; onNavigate?: () => void }) {
  const path = usePathname();
  const sp = useSearchParams();
  const full = path + (sp.toString() ? `?${sp.toString()}` : "");
  const isActive = (href: string) =>
    href.includes("?")
      ? full === href
      : href === "/"
        ? path === "/"
        : path === href ||
          (path.startsWith(href + "/") &&
            !groups.some((g) =>
              g.items.some(
                (i) => i.href !== href && i.href.startsWith(href + "/") && path.startsWith(i.href),
              ),
            ));

  const [open, setOpen] = useState<Set<string>>(() => {
    const active = groupFor(groups, path);
    return new Set(active ? [active] : []);
  });
  // Navigating to a route in a not-yet-open group expands it, without closing anything else.
  useEffect(() => {
    const active = groupFor(groups, path);
    if (active) setOpen((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [path, groups]);

  const toggle = (title: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const itemClass = (href: string) =>
    cn(
      "block rounded-md px-3 py-1.5 text-[13px] text-slate-300 hover:bg-white/10 hover:text-white",
      isActive(href) && "bg-white/15 font-medium text-white",
    );

  return (
    <nav className="space-y-1 pb-8">
      {groups.map((g) => {
        // A single-item group (e.g. "Dashboard") is just a direct link — no dropdown needed.
        if (g.items.length <= 1) {
          const i = g.items[0];
          if (!i) return null;
          return (
            <Link
              key={g.title}
              href={i.href}
              onClick={onNavigate}
              className={cn(itemClass(i.href), "font-semibold")}
            >
              {g.title}
            </Link>
          );
        }
        const isOpen = open.has(g.title);
        let lastSection: string | undefined;
        return (
          <div key={g.title}>
            <button
              type="button"
              onClick={() => toggle(g.title)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200"
            >
              {g.title}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <ul className="space-y-0.5 pb-1">
                {g.items.map((i) => {
                  const showSection = i.section && i.section !== lastSection;
                  lastSection = i.section ?? lastSection;
                  return (
                    <li key={g.title + i.href + i.label}>
                      {showSection && (
                        <p className="mb-0.5 mt-2 px-3 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                          {i.section}
                        </p>
                      )}
                      <Link href={i.href} onClick={onNavigate} className={itemClass(i.href)}>
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-3 py-4 text-white">
      <Shield className="h-6 w-6 text-sky-300" />
      <span className="text-base font-semibold tracking-tight">WorkforcePay</span>
    </Link>
  );
}

export function Sidebar({ groups, org }: { groups: Group[]; org: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 overflow-y-auto bg-slate-900 px-2 lg:block">
        <Brand />
        <p className="mb-3 truncate px-3 text-[11px] text-slate-400">{org}</p>
        <NavList groups={groups} />
      </aside>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-3 py-2 lg:hidden">
        <Brand />
        <button aria-label="Open menu" className="rounded p-2 text-white" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-slate-900 px-2">
            <div className="flex items-center justify-between">
              <Brand />
              <button aria-label="Close menu" className="p-2 text-white" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
