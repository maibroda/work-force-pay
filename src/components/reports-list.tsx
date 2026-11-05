"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { searchPages } from "@/lib/nav";
import { Card } from "@/components/ui/card";

export interface ReportItem {
  href: string;
  label: string;
  group: string;
}

/** The Reports page: every report the person may open, grouped by part of the business, with a search that narrows them as you type. */
export function ReportsList({ items }: { items: ReportItem[] }) {
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.trim() ? searchPages(items.map((i) => ({ ...i, where: i.group })), q, 50) : null), [items, q]);
  const groups = [...new Set(items.map((i) => i.group))];
  const card = (i: ReportItem) => (
    <Link key={i.href} href={i.href}>
      <Card className="p-4 hover:bg-accent">
        <p className="font-medium">{i.label}</p>
        {found && <p className="text-xs text-muted-foreground">{i.group}</p>}
      </Card>
    </Link>
  );
  return (
    <>
      <label className="no-print mb-4 flex max-w-md items-center gap-2 rounded border bg-background px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary/40">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="sr-only">Search the reports</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the reports, e.g. pension, bank, audit" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" autoComplete="off" />
      </label>
      {found ? (
        found.length === 0 ? (
          <p className="text-sm text-muted-foreground">No report matches &ldquo;{q.trim()}&rdquo;.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{found.map(card)}</div>
        )
      ) : (
        groups.map((g) => (
          <section key={g} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.filter((i) => i.group === g).map(card)}</div>
          </section>
        ))
      )}
    </>
  );
}
