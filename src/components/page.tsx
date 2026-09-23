import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: Array<{ href: string; label: string }>;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {crumbs && (
          <nav className="mb-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
            {crumbs.map((c) => (
              <span key={c.href}>
                <Link className="hover:underline" href={c.href}>
                  {c.label}
                </Link>{" "}
                /
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "red" | "amber" | "green";
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "red" && "text-red-700",
          tone === "amber" && "text-amber-700",
          tone === "green" && "text-emerald-700",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export function StatGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  const c = {
    2: "lg:grid-cols-2",
    3: "lg:grid-cols-3",
    4: "lg:grid-cols-4",
    5: "lg:grid-cols-5",
    6: "lg:grid-cols-6",
  }[cols];
  return <div className={cn("mb-5 grid grid-cols-2 gap-3", c)}>{children}</div>;
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <Card className={cn("mb-5", className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className={flush ? "p-0" : undefined}>{children}</CardContent>
    </Card>
  );
}

/** Collapsible create/edit form panel. */
export function FormPanel({
  title,
  children,
  open,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="no-print group mb-5 rounded-lg border bg-card shadow-sm">
      <summary className="cursor-pointer select-none list-none px-4 py-3 text-sm font-semibold text-primary">
        <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span> {title}
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function KV({ items, cols = 3 }: { items: Array<[string, React.ReactNode]>; cols?: 2 | 3 | 4 }) {
  const c = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[cols];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", c)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** GET filter bar — plain form so filters are shareable URLs and work without JS. */
export function FilterBar({ children, action }: { children: React.ReactNode; action?: string }) {
  return (
    <form method="get" action={action} className="no-print mb-4 flex flex-wrap items-end gap-2">
      {children}
      <button
        className="h-9 rounded-md border border-input bg-card px-3 text-sm hover:bg-accent"
        type="submit"
      >
        Apply
      </button>
    </form>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-foreground/80">
      {label}
      {children}
    </label>
  );
}
