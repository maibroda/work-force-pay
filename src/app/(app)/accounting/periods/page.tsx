import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listFiscalYears } from "@/server/services/periods";
import { nextStatus, PERIOD_STATUS_LABELS, type PeriodStatus } from "@/lib/fiscal";
import { fmtDate, iso } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createFiscalYearAction, transitionPeriodAction } from "@/app/actions/periods";

const tone: Record<PeriodStatus, "green" | "amber" | "gray" | "red"> = { OPEN: "green", SOFT_CLOSED: "amber", CLOSED: "gray", LOCKED: "red" };

export default async function PeriodsPage() {
  const ctx = await requirePage("gl.view");
  const { years, startMonth } = await listFiscalYears(ctx);
  const canClose = can(ctx.role, "period.close");
  const canApprove = can(ctx.role, "period.approve");
  const canReopen = can(ctx.role, "period.reopen");
  return (
    <>
      <PageHeader
        title="Accounting periods"
        description={`Every journal belongs to a monthly period, and the period's status decides whether anything can be posted into it. Open: anyone who may post can. Soft closed: only finance staff with the close permission, for final adjustments. Closed: nothing can be posted; reopening needs a reason. Locked: final. Closing takes two people (whoever soft closed a period can't also close it), and a period can only be closed once every earlier one has been. Years are created when the first journal is posted into them, or ahead of time below. The financial year starts in month ${startMonth}.`}
      />
      {canApprove && (
        <FormPanel title="Create a financial year ahead of time">
          <SmartForm
            columns={2}
            submitLabel="Create year"
            action={createFiscalYearAction}
            fields={[{ name: "containing", label: "Any date in the year", type: "date", required: true, defaultValue: iso(new Date()), help: "Creates the year containing this date, with its twelve open periods." }]}
          />
        </FormPanel>
      )}
      {years.map((y) => (
        <Section key={y.id} title={`${y.name} — ${fmtDate(y.startDate)} to ${fmtDate(y.endDate)}`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Period</TH>
                <TH>Dates</TH>
                <TH>Journals</TH>
                <TH>Status</TH>
                <TH>Last change</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {y.periods.map((p) => {
                const s = p.status as PeriodStatus;
                const last = p.events[0];
                return (
                  <TR key={p.id}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD className="text-xs">
                      {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                    </TD>
                    <TD>{p._count.journals}</TD>
                    <TD>
                      <Badge tone={tone[s]}>{PERIOD_STATUS_LABELS[s]}</Badge>
                    </TD>
                    <TD className="max-w-[18rem] whitespace-normal text-xs text-muted-foreground">{last ? `${last.action.replace("_", " ").toLowerCase()} by ${last.actor}, ${fmtDate(last.createdAt)}${last.reason ? ` — ${last.reason}` : ""}` : "—"}</TD>
                    <TD className="space-x-1 whitespace-nowrap text-right">
                      {canClose && nextStatus("SOFT_CLOSE", s) && (
                        <ActionButton action={transitionPeriodAction.bind(null, p.id, "SOFT_CLOSE")} confirm={`Soft close ${p.name}? Only finance staff with the close permission can post into it afterwards.`} variant="outline">
                          Soft close
                        </ActionButton>
                      )}
                      {canApprove && nextStatus("CLOSE", s) && (
                        <ActionButton action={transitionPeriodAction.bind(null, p.id, "CLOSE")} confirm={`Close ${p.name}? Nothing can be posted into it until it is reopened.`} variant="success">
                          Close
                        </ActionButton>
                      )}
                      {canApprove && nextStatus("LOCK", s) && (
                        <ActionButton action={transitionPeriodAction.bind(null, p.id, "LOCK")} confirm={`Lock ${p.name} for good? A locked period can never be reopened.`} variant="outline">
                          Lock
                        </ActionButton>
                      )}
                      {canReopen && nextStatus("REOPEN", s) && (
                        <ActionButton action={transitionPeriodAction.bind(null, p.id, "REOPEN")} reason reasonPlaceholder="Why this period is being reopened" variant="outline">
                          Reopen
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      ))}
      {!years.length && (
        <Section title="No financial years yet">
          <Empty>The first journal posted creates its financial year. You can also create one above.</Empty>
        </Section>
      )}
    </>
  );
}
