import { requirePage } from "@/lib/auth/session";
import { supervisorToday } from "@/server/services/operations";
import { daysInMonth, iso } from "@/lib/dates";
import { FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { AttendanceSheet, MonthlyAttendanceSheet } from "@/components/attendance-sheet";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { bulkAttendanceAction, recordMonthlyAttendanceAction } from "@/app/actions/operations";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("attendance.record");
  const sp = await searchParams;
  const date = sp.date ?? iso(new Date());
  const [year, month] = date.split("-").map(Number);
  const dim = daysInMonth(year, month);
  const all = await supervisorToday(ctx, date);
  const beats = sp.beatId ? all.filter((b) => b.beat.id === sp.beatId) : all;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <PageHeader
        title="Attendance by location"
        description="Attendance is recorded against the beat (location), not just the employee. Staff shown are those deployed to the beat on the selected date."
      />
      <FilterBar>
        <FilterField label="Date">
          <Input type="date" name="date" defaultValue={date} />
        </FilterField>
        <FilterField label="Beat">
          <Select name="beatId" defaultValue={sp.beatId ?? ""}>
            <option value="">All beats</option>
            {all.map((b) => (
              <option key={b.beat.id} value={b.beat.id}>
                {b.beat.client.name} — {b.beat.name}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <div className="grid gap-5 lg:grid-cols-2">
        {beats.map((b) => (
          <Section
            key={b.beat.id}
            title={`${b.beat.client.name} — ${b.beat.name}`}
            description={
              <span className="flex flex-wrap gap-1">
                <Badge tone="green">{b.present} present</Badge>
                <Badge tone="amber">{b.late} late</Badge>
                <Badge tone="red">{b.absent} absent</Badge>
                <Badge>{b.unrecorded} unrecorded</Badge>
                {b.replacementRequired > 0 && (
                  <Badge tone="red">{b.replacementRequired} replacement(s) required</Badge>
                )}
              </span>
            }
          >
            <AttendanceSheet beatId={b.beat.id} date={date} staff={b.staff} action={bulkAttendanceAction} />
            <details className="mt-4 rounded-md border">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-primary">
                Monthly attendance (quick entry) — {monthLabel}
              </summary>
              <div className="border-t p-3">
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {dim} days in {monthLabel}. Adjust &quot;days worked&quot; down from the full month for
                  anyone who didn&apos;t work every day — the rest of the month is marked absent. Approved
                  leave days are left untouched.
                </p>
                <MonthlyAttendanceSheet
                  beatId={b.beat.id}
                  year={year}
                  month={month}
                  daysInMonth={dim}
                  staff={b.staff}
                  action={recordMonthlyAttendanceAction}
                />
              </div>
            </details>
          </Section>
        ))}
      </div>
    </>
  );
}
