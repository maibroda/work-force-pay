import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { supervisorToday } from "@/server/services/operations";
import { pendingLeaveCount } from "@/server/services/leave";
import { iso, fmtDate } from "@/lib/dates";
import { FilterBar, FilterField, Empty } from "@/components/page";
import { AttendanceSheet } from "@/components/attendance-sheet";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { bulkAttendanceAction } from "@/app/actions/operations";

/** Mobile-first supervisor dashboard: today's work register by location. */
export default async function SupervisorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("attendance.record");
  const sp = await searchParams;
  const date = sp.date ?? iso(new Date());
  const [beats, pendingLeave] = await Promise.all([supervisorToday(ctx, date), pendingLeaveCount(ctx)]);
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-lg font-semibold">Today&apos;s work register</h1>
      <p className="mb-3 text-sm text-muted-foreground">
        {fmtDate(date)} · {beats.length} location(s)
      </p>
      {pendingLeave > 0 && (
        <Link
          href="/leave"
          className="mb-3 block rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {pendingLeave} leave request{pendingLeave > 1 ? "s" : ""} awaiting your approval →
        </Link>
      )}
      <FilterBar>
        <FilterField label="Date">
          <Input type="date" name="date" defaultValue={date} />
        </FilterField>
      </FilterBar>
      {!beats.length && <Empty>No beats assigned to you.</Empty>}
      <div className="space-y-4">
        {beats.map((b) => (
          <Card key={b.beat.id} className="p-3">
            <p className="font-semibold">{b.beat.name}</p>
            <p className="mb-2 text-xs text-muted-foreground">
              {b.beat.client.name} · approved {b.beat.approvedStrength}
            </p>
            <div className="mb-3 grid grid-cols-5 gap-1 text-center text-[11px]">
              <div className="rounded bg-slate-100 p-1">
                <b className="block text-base">{b.staff.length}</b>Staff
              </div>
              <div className="rounded bg-emerald-50 p-1">
                <b className="block text-base text-emerald-700">{b.present}</b>Present
              </div>
              <div className="rounded bg-red-50 p-1">
                <b className="block text-base text-red-700">{b.absent}</b>Absent
              </div>
              <div className="rounded bg-amber-50 p-1">
                <b className="block text-base text-amber-700">{b.late}</b>Late
              </div>
              <div className="rounded bg-violet-50 p-1">
                <b className="block text-base text-violet-700">{b.replacementRequired}</b>Replace
              </div>
            </div>
            <AttendanceSheet
              beatId={b.beat.id}
              date={date}
              staff={b.staff}
              action={bulkAttendanceAction}
              compact
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
