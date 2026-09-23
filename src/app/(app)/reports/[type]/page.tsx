import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { buildReport, REPORT_TYPES, type ReportType } from "@/server/report-registry";
import { options, runOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { type } = await params;
  if (!REPORT_TYPES.includes(type as ReportType)) notFound();
  const ctx = await requirePage(type === "audit" ? "audit.view" : "reports.view");
  const sp = await searchParams;
  const [report, runs, o] = await Promise.all([
    buildReport(ctx, type as ReportType, sp),
    runOptions(ctx),
    options(ctx),
  ]);
  if (!report) notFound();
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const fmt = (c: { money?: boolean }, v: unknown) =>
    c.money ? naira(v) : v === null || v === undefined ? "" : String(v);
  return (
    <>
      <PageHeader
        title={report.title}
        description={
          <>
            {report.description}
            {report.runLabel && (
              <>
                {" "}
                · <b>{report.runLabel}</b>
              </>
            )}
          </>
        }
        crumbs={[{ href: "/reports", label: "Reports" }]}
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/reports/${type}?${qs}`}>
              Download CSV
            </a>
            <PrintButton />
          </>
        }
      />
      <FilterBar>
        {report.usesRun && (
          <FilterField label="Payroll run">
            <Select name="runId" defaultValue={sp.runId} className="min-w-64">
              {runs.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        {report.filters.includes("client") && (
          <FilterField label="Client">
            <Select name="clientId" defaultValue={sp.clientId ?? ""}>
              <option value="">All clients</option>
              {o.clients.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        {report.filters.includes("beat") && (
          <FilterField label="Beat">
            <Select name="beatId" defaultValue={sp.beatId ?? ""}>
              <option value="">All beats</option>
              {o.beats.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        {report.filters.includes("employee") && (
          <FilterField label="Employee">
            <Select name="employeeId" defaultValue={sp.employeeId ?? ""} className="w-64">
              <option value="">{type === "location-history" ? "— Select —" : "All"}</option>
              {o.employees.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FilterField>
        )}
        {report.filters.includes("dateRange") && (
          <>
            <FilterField label="From">
              <Input type="date" name="from" defaultValue={sp.from} />
            </FilterField>
            <FilterField label="To">
              <Input type="date" name="to" defaultValue={sp.to} />
            </FilterField>
          </>
        )}
        {type === "audit" && (
          <FilterField label="Search">
            <Input name="q" defaultValue={sp.q} placeholder="user, entity id, reason" />
          </FilterField>
        )}
      </FilterBar>
      <Section title={`${report.rows.filter((r) => !r._total).length} row(s)`} flush>
        <Table>
          <THead>
            <TR>
              {report.columns.map((c) => (
                <TH key={c.key} className={c.money || c.num ? "text-right" : ""}>
                  {c.label}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {report.rows.map((r, i) => (
              <TR
                key={i}
                className={cn(
                  r._total ? "bg-muted/60 font-semibold" : "",
                  String(r.flagText ?? "").length ? "bg-amber-50/60" : "",
                  r.exception ? "bg-red-50" : "",
                )}
              >
                {report.columns.map((c) => (
                  <TD
                    key={c.key}
                    className={cn(
                      c.money || c.num ? "text-right tabular-nums" : "",
                      c.key === "change" || c.key === "flagText" || c.key === "reason"
                        ? "max-w-md whitespace-normal text-xs"
                        : "",
                    )}
                  >
                    {c.key === "link" ? (
                      <Link className="text-primary underline" href={String(r.link)}>
                        View
                      </Link>
                    ) : (
                      fmt(c, r[c.key])
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
          {report.totals && report.rows.length > 0 && (
            <TFoot>
              <TR>
                {report.columns.map((c, i) => (
                  <TD key={c.key} className={c.money || c.num ? "text-right tabular-nums" : ""}>
                    {i === 0 ? "Total" : c.key in (report.totals ?? {}) ? fmt(c, report.totals![c.key]) : ""}
                  </TD>
                ))}
              </TR>
            </TFoot>
          )}
        </Table>
        {!report.rows.length && <Empty>No data for this selection.</Empty>}
      </Section>
    </>
  );
}
