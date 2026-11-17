import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { trainingSpend } from "@/server/services/training-cost";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { setBudgetAction } from "@/app/actions/training-cost";
import { naira } from "@/lib/money";

const n = (v: string | null) => (v === null ? "—" : naira(Number(v)));

/**
 * What training cost in a year. A record kept by HR: nothing is posted to the accounts and no payment is made. Anyone with HR view may read it. No figure names or numbers a person, and a row from
 * fewer than three attendances is not shown on its own.
 */
export default async function TrainingSpendPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : new Date().getUTCFullYear();
  const r = await trainingSpend(ctx, year);
  const manage = can(ctx.role, "hr.manage");
  const departments = manage ? await db.department.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  return (
    <>
      <PageHeader title="Training spend" description={`What training cost in ${year}, from the approved cost lines HR recorded on each session. A record only: nothing is posted to the accounts.`} />
      <p className="mb-4 rounded bg-slate-100 p-3 text-xs text-slate-700">{r.note}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {[year - 1, year, year + 1].map((y) => (
          <a key={y} href={`/hr/training-spend?year=${y}`} className={y === year ? "font-semibold underline" : "text-primary underline"}>
            {y}
          </a>
        ))}
      </div>
      <Section title={`Total for ${year}`}>
        <p className="text-2xl font-semibold">{n(r.total)}</p>
        {Number(r.pendingTotal) !== 0 && <p className="mt-1 text-xs text-amber-700">{n(r.pendingTotal)} more is waiting for a second person to approve it and is not counted.</p>}
        {r.budget.company !== null ? (
          <p className={`mt-2 text-sm ${r.budget.over ? "text-red-700" : ""}`}>
            Company budget {n(r.budget.company)}: {r.budget.over ? `over budget by ${n(String(Math.abs(Number(r.budget.remaining))))}` : `${n(r.budget.remaining)} left`}. This is a warning, never a block.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No company budget is set for {year}.</p>
        )}
      </Section>

      {(["byProgramme", "byMonth", "byDepartment"] as const).map((key) => {
        const title = key === "byProgramme" ? "By programme" : key === "byMonth" ? "By month" : "By department (a session's cost shared equally per attendee)";
        const b = r[key];
        return (
          <Section key={key} title={title} flush>
            {b.shown.length === 0 && !b.other ? (
              <Empty>Nothing to show for {year}.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{key === "byProgramme" ? "Programme" : key === "byMonth" ? "Month" : "Department"}</TH>
                    <TH>Cost</TH>
                    <TH>Attendances</TH>
                    {key === "byProgramme" && <TH>Per attendee</TH>}
                    {key === "byDepartment" && <TH>Budget</TH>}
                  </TR>
                </THead>
                <TBody>
                  {b.shown.map((row) => {
                    const x = row as { name: string; total: string; attendances: number; perAttendee?: string | null; budget?: string | null; over?: boolean };
                    return (
                      <TR key={x.name}>
                        <TD>{x.name}</TD>
                        <TD>{n(x.total)}</TD>
                        <TD>{x.attendances}</TD>
                        {key === "byProgramme" && <TD>{n(x.perAttendee ?? null)}</TD>}
                        {key === "byDepartment" && <TD className={x.over ? "text-red-700" : ""}>{x.budget ? `${n(x.budget)}${x.over ? " (over)" : ""}` : "—"}</TD>}
                      </TR>
                    );
                  })}
                  {b.other && (
                    <TR>
                      <TD className="text-muted-foreground">Other (rows with fewer than three attendances, combined)</TD>
                      <TD>{b.other.shown ? n(b.other.total) : "not shown"}</TD>
                      <TD>{b.other.attendances}</TD>
                      {(key === "byProgramme" || key === "byDepartment") && <TD>—</TD>}
                    </TR>
                  )}
                </TBody>
              </Table>
            )}
          </Section>
        );
      })}

      {manage && (
        <Section title="Budget" description="One for the company (leave the department empty) and, if you want, one per department. Setting it again replaces it; an empty amount removes it. Over budget is a warning, never a block.">
          <SmartForm
            columns={3}
            submitLabel="Save the budget"
            resetOnSuccess={false}
            action={setBudgetAction}
            fields={[
              { name: "year", label: "Year", type: "number", required: true, min: 2000, max: 2100, defaultValue: year },
              { name: "departmentId", label: "Department (empty = the whole company)", type: "select", options: departments.map((d) => ({ value: d.id, label: d.name })) },
              { name: "amount", label: "Budget in naira (empty = remove)", type: "text", placeholder: "e.g. 2500000", help: "Naira, up to two decimals." },
            ]}
          />
        </Section>
      )}
    </>
  );
}
