import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { dashboard, DASHBOARDS, drillRecords, type View } from "@/server/services/sales/reports";
import type { ColKind, Widget } from "@/lib/sales/reports";
import { PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const VIEWS: Array<[View, string]> = [["sales", "Sales"], ["accounts", "Accounts"], ["service", "Service"]];
const show = (v: string | number, kind: ColKind) => (kind === "money" && typeof v === "string" && v !== "—" ? `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : v);
const RIGHT: ColKind[] = ["count", "money", "percent", "days"];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string; from?: string; to?: string; drill?: string }> }) {
  const ctx = await requirePage("sales.view");
  const q = await searchParams;
  const view: View = (q.view && q.view in DASHBOARDS ? q.view : "sales") as View;
  const period = { from: q.from || undefined, to: q.to || undefined };
  let widgets: Widget[];
  let problem: string | null = null;
  try {
    widgets = await dashboard(ctx, view, period);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    problem = e.message;
    widgets = [];
  }
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ view, ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}), ...extra });
    return `/sales/reports?${p}`;
  };
  const csv = (key: string, records = false) => `/api/sales/reports/${key}?${new URLSearchParams({ ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}), ...(records ? { records: "1" } : {}) })}`;
  const [drillKey, drillRow] = (q.drill ?? "").split(".");

  return (
    <>
      <PageHeader title="Reports" description="What the sales team has done and what is coming, from the records you may see (a salesperson sees their own; managers and Operations see everyone's). Each widget says what its date filter applies to, shows the records behind every figure, and can be downloaded as CSV." />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={qs({ view: v })} className={`rounded px-3 py-1 ${v === view ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            {label}
          </Link>
        ))}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="view" value={view} />
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">From (Lagos date)</span>
          <input type="date" name="from" defaultValue={period.from} className="h-9 rounded-md border bg-background px-2" />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">To (included)</span>
          <input type="date" name="to" defaultValue={period.to} className="h-9 rounded-md border bg-background px-2" />
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-primary-foreground">Apply</button>
        {(period.from || period.to) && <Link className="text-xs underline" href={qs({}).replace(/&?(from|to)=[^&]*/g, "")}>Clear dates</Link>}
      </form>
      {problem && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-900">{problem}</p>}

      {await Promise.all(
        widgets.map(async (w) => {
          const open = drillKey === w.key ? w.rows[Number(drillRow)] : undefined;
          const records = open?.ids ? await drillRecords(ctx, w.records, open.ids) : [];
          return (
            <Section key={w.key} title={w.title} description={w.note} flush>
              {w.columns.length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      {w.columns.map((c) => (
                        <TH key={c.label} className={RIGHT.includes(c.kind) ? "text-right" : undefined}>{c.label}</TH>
                      ))}
                      <TH />
                    </TR>
                  </THead>
                  <TBody>
                    {w.rows.map((r, i) => (
                      <TR key={i}>
                        {r.cells.map((cell, j) => (
                          <TD key={j} className={`${RIGHT.includes(w.columns[j].kind) ? "text-right" : "whitespace-normal"} text-xs`}>{show(cell, w.columns[j].kind)}</TD>
                        ))}
                        <TD className="text-xs">{r.ids?.length ? <Link className="underline" href={qs({ drill: `${w.key}.${i}` })}>Records ({r.ids.length})</Link> : ""}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : null}
              {w.rows.length === 0 && w.columns.length > 0 && <p className="px-4 py-4 text-sm text-muted-foreground">Nothing to show for this period.</p>}
              {open && (
                <div className="border-t px-4 py-3 text-sm">
                  <p className="mb-1 font-medium">Records behind &ldquo;{open.cells[0]}{typeof open.cells[1] === "string" ? ` / ${open.cells[1]}` : ""}&rdquo;{open.ids!.length > records.length ? ` (the first ${records.length} of ${open.ids!.length})` : ""}</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {records.map((r) => (
                      <li key={r.id}>{r.href ? <Link className="underline" href={r.href}>{r.label}</Link> : r.label}</li>
                    ))}
                  </ul>
                  {!records.length && <p className="text-muted-foreground">None you may see.</p>}
                </div>
              )}
              {w.columns.length > 0 && (
                <p className="flex gap-4 border-t px-4 py-2 text-xs">
                  <a className="underline" href={csv(w.key)}>Download CSV</a>
                  <a className="underline" href={csv(w.key, true)}>Download CSV with the records</a>
                </p>
              )}
            </Section>
          );
        }),
      )}
    </>
  );
}
