import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, d, eachDay, fmtShort, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { options } from "@/server/options";

const CELL: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-800",
  LATE: "bg-amber-100 text-amber-800",
  ABSENT: "bg-red-100 text-red-800",
  LEAVE: "bg-blue-100 text-blue-800",
  OFF: "bg-slate-100 text-slate-600",
  SUSPENDED: "bg-orange-100 text-orange-800",
};

export default async function RostersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("operations.view");
  const sp = await searchParams;
  const o = await options(ctx);
  const beatId = sp.beatId ?? o.beats[0]?.value;
  const start = d(sp.start ?? iso(addDays(new Date(), -6)));
  const days = eachDay(start, addDays(start, 13));
  const end = days[days.length - 1];
  const [deps, work] = beatId
    ? await Promise.all([
        db.deployment.findMany({
          where: {
            organizationId: ctx.orgId,
            beatId,
            startDate: { lte: end },
            OR: [{ endDate: null }, { endDate: { gte: start } }],
          },
          include: { employee: true },
        }),
        db.workRegister.findMany({
          where: { organizationId: ctx.orgId, beatId, date: { gte: start, lte: end } },
        }),
      ])
    : [[], []];
  const emps = [...new Map(deps.map((x) => [x.employeeId, x.employee])).values()].sort((a, b) =>
    a.employeeNumber.localeCompare(b.employeeNumber),
  );
  const cell = (eid: string, dt: Date) =>
    work.find((w) => w.employeeId === eid && w.date.getTime() === dt.getTime());
  const deployed = (eid: string, dt: Date) =>
    deps.some((x) => x.employeeId === eid && x.startDate <= dt && (!x.endDate || x.endDate >= dt));
  return (
    <>
      <PageHeader
        title="Rosters"
        description="Two-week roster per beat: planned deployment (outlined) against recorded attendance."
      />
      <FilterBar>
        <FilterField label="Beat">
          <Select name="beatId" defaultValue={beatId}>
            {o.beats.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Start date">
          <Input type="date" name="start" defaultValue={iso(start)} />
        </FilterField>
      </FilterBar>
      <Section title="Roster" flush>
        {emps.length ? (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card px-3 py-2 text-left">Employee</th>
                  {days.map((dt) => (
                    <th key={dt.toISOString()} className="px-1 py-2 font-medium text-muted-foreground">
                      {fmtShort(dt)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {emps.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-1.5">
                      <span className="font-mono">{e.employeeNumber}</span> {fullName(e)}
                    </td>
                    {days.map((dt) => {
                      const w = cell(e.id, dt);
                      const dep = deployed(e.id, dt);
                      return (
                        <td key={dt.toISOString()} className="px-0.5 py-1">
                          <div
                            title={w?.attendanceStatus ?? (dep ? "Rostered, not recorded" : "Not deployed")}
                            className={`mx-auto flex h-6 w-9 items-center justify-center rounded text-[10px] font-medium ${w ? CELL[w.attendanceStatus] : dep ? "border border-dashed border-slate-300" : ""}`}
                          >
                            {w ? w.attendanceStatus.slice(0, 3) : ""}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No employees deployed at this beat in the window.</Empty>
        )}
      </Section>
    </>
  );
}
