import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { listHolidays } from "@/server/services/holidays";
import { holidayStatesOfYear, hourlyPayEnabled } from "@/server/services/hourly-pay";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addHolidayAction, confirmHolidayYearAction, removeHolidayAction } from "@/app/actions/holidays";
import { setHolidayStatesAction } from "@/app/actions/hourly-pay";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : thisYear;
  const { holidays, confirmed } = await listHolidays(ctx, year);
  // with hourly pay switched on, a holiday can be limited to states (the state of the work location decides which holidays apply to an hour worked)
  const hourly = await hourlyPayEnabled(ctx.orgId);
  const states = hourly ? await holidayStatesOfYear(ctx, year) : {};
  const manage = can(ctx.role, "payroll.run");
  const confirm = can(ctx.role, "payrate.approve");
  return (
    <>
      <PageHeader
        title="Public holidays"
        description="The company's public holidays for the year. Some are announced each year, so no date is built in: enter them, then a payroll manager confirms the year. A contract that is paid on working days without the public holidays uses these dates, and cannot be paid cleanly for a month in an unconfirmed year. Changing a confirmed year un-confirms it."
      />
      <nav aria-label="Year" className="no-print mb-3 flex flex-wrap gap-2 text-sm">
        {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
          <Link key={y} href={`/payroll/holidays?year=${y}`} aria-current={y === year ? "true" : undefined} className={y === year ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground" : "rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground"}>
            {y}
          </Link>
        ))}
      </nav>
      <Section
        title={`${year}: ${holidays.length} holiday(s)`}
        actions={
          confirmed ? (
            <Badge tone="green">
              Confirmed by {confirmed.confirmedBy} on {fmtDate(confirmed.confirmedAt)}
            </Badge>
          ) : confirm ? (
            <ActionButton action={confirmHolidayYearAction.bind(null, year)} confirm={`Confirm that the list of public holidays for ${year} is complete and right?`} variant="success">
              Confirm {year}
            </ActionButton>
          ) : (
            <Badge tone="amber">Not confirmed</Badge>
          )
        }
        flush
      >
        {holidays.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Holiday</TH>
                {hourly && <TH>Applies to</TH>}
                {manage && <TH />}
              </TR>
            </THead>
            <TBody>
              {holidays.map((h) => (
                <TR key={h.id}>
                  <TD>{fmtDate(h.date)}</TD>
                  <TD>{h.name}</TD>
                  {hourly && <TD className="text-xs">{states[h.id]?.length ? states[h.id].join(", ") : "Every state"}</TD>}
                  {manage && (
                    <TD className="text-right">
                      <ActionButton action={removeHolidayAction.bind(null, h.id)} confirm="Remove this holiday? The year will need confirming again." variant="outline">
                        Remove
                      </ActionButton>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No holidays entered for {year}.</Empty>
        )}
      </Section>
      {manage && (
        <FormPanel title="Add a public holiday">
          <SmartForm
            columns={2}
            submitLabel="Add"
            action={addHolidayAction}
            fields={[
              { name: "date", label: "Date", type: "date", required: true },
              { name: "name", label: "Holiday", required: true, placeholder: "e.g. Independence Day" },
            ]}
          />
        </FormPanel>
      )}
      {manage && hourly && holidays.length > 0 && (
        <FormPanel title="Limit a holiday to states (hourly pay)">
          <SmartForm
            columns={2}
            submitLabel="Save"
            action={setHolidayStatesAction}
            fields={[
              { name: "holidayId", label: "Holiday", type: "select", required: true, options: holidays.map((h) => ({ value: h.id, label: `${fmtDate(h.date)} — ${h.name}` })) },
              { name: "states", label: "States it applies in", placeholder: "e.g. Lagos, Ogun (leave empty for every state)", help: "The state of the place where the hours were worked decides which holidays apply. Changing this takes the year's confirmation away." },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
