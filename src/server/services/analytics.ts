import type { Ctx } from "@/lib/auth/context";
import { num, round2 } from "@/lib/money";
import { db } from "./_base";
import { payrollByClientAndBeat, resolveRun } from "./reports";

export async function dashboard(ctx: Ctx) {
  const run = await resolveRun(ctx);
  const [employees, activeEmployees, activeClients, activeBeats, statusGroups, runs] = await Promise.all([
    db.employee.count({ where: { organizationId: ctx.orgId } }),
    db.employee.count({ where: { organizationId: ctx.orgId, status: "ACTIVE" } }),
    db.client.count({ where: { organizationId: ctx.orgId, status: "ACTIVE" } }),
    db.beat.count({ where: { organizationId: ctx.orgId, status: { not: "INACTIVE" } } }),
    db.employee.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: { _all: true } }),
    db.payrollRun.findMany({
      where: { organizationId: ctx.orgId, type: "REGULAR", status: { not: "SUPERSEDED" } },
      include: { period: true },
      orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }],
    }),
  ]);
  const byClient = run ? await payrollByClientAndBeat(ctx, run.id) : [];
  const byBeat = byClient
    .flatMap((c) =>
      c.beats.map((b) => ({
        name: b.beatName,
        client: c.clientName,
        region: b.region,
        value: round2(b.gross + b.overtime),
        headcount: b.headcount,
      })),
    )
    .sort((a, b) => b.value - a.value);
  const regions = new Map<string, number>();
  for (const b of byBeat)
    regions.set(b.region ?? "Head Office", round2((regions.get(b.region ?? "Head Office") ?? 0) + b.value));
  return {
    run,
    employees,
    activeEmployees,
    activeClients,
    activeBeats,
    statusGroups: statusGroups.map((s) => ({ status: s.status, count: s._count._all })),
    trend: runs.map((r) => ({
      period: r.period.name.slice(0, 3) + " " + String(r.period.year).slice(2),
      gross: num(r.totalGross),
      net: num(r.totalNet),
      employerCost: num(r.totalEmployerCost),
    })),
    byClient: byClient.map((c) => ({
      name: c.clientName,
      gross: round2(c.gross + c.overtime),
      billing: c.clientBilling,
      margin: c.margin,
      headcount: c.headcount,
    })),
    byBeat,
    byRegion: [...regions.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  };
}

export async function locationAnalytics(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) return null;
  const { startDate, endDate } = run.period;
  const [beats, work, overtime, deps, byClient] = await Promise.all([
    db.beat.findMany({ where: { organizationId: ctx.orgId }, include: { client: true } }),
    db.workRegister.groupBy({
      by: ["beatId", "attendanceStatus"],
      where: { organizationId: ctx.orgId, date: { gte: startDate, lte: endDate } },
      _count: { _all: true },
    }),
    db.overtime.groupBy({
      by: ["beatId"],
      where: { organizationId: ctx.orgId, periodId: run.periodId, status: { in: ["APPROVED", "PROCESSED"] } },
      _sum: { hours: true, amount: true },
    }),
    db.deployment.groupBy({
      by: ["beatId"],
      where: { organizationId: ctx.orgId, status: "ACTIVE" },
      _count: { _all: true },
    }),
    payrollByClientAndBeat(ctx, runId),
  ]);
  const payMap = new Map(byClient.flatMap((c) => c.beats.map((b) => [b.beatId, b])));
  return beats.map((b) => {
    const w = work.filter((x) => x.beatId === b.id);
    const total = w.reduce((a, x) => a + x._count._all, 0);
    const present = w
      .filter((x) => ["PRESENT", "LATE"].includes(x.attendanceStatus))
      .reduce((a, x) => a + x._count._all, 0);
    const ot = overtime.find((x) => x.beatId === b.id);
    const actual = deps.find((x) => x.beatId === b.id)?._count._all ?? 0;
    const p = payMap.get(b.id);
    return {
      beat: b.name,
      client: b.client.name,
      region: b.region ?? "—",
      employees: actual,
      approved: b.approvedStrength,
      vacancy: Math.max(0, b.approvedStrength - actual),
      attendancePct: total ? round2((present / total) * 100) : 0,
      overtimeHours: num(ot?._sum.hours),
      overtimeAmount: num(ot?._sum.amount),
      payroll: p ? round2(p.gross + p.overtime) : 0,
    };
  });
}
