/**
 * Read models that stitch the lifecycle modules together: the HR overview, the cross-employee
 * onboarding and exit trackers, and one employee's end-to-end timeline.
 */
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { assertCan, db } from "./_base";
import { contractAlerts } from "./contracts";
import { outstandingKitValue } from "./inventory";
import { todayUtc } from "./hr-policy";
import { caseStats } from "./relations";
import { recruitmentSummary } from "./recruitment";

export async function hrOverview(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const [recruitment, contracts, cases, onboarding, exitsPending, exitsActive, settlements, expiringDocs] =
    await Promise.all([
      recruitmentSummary(ctx),
      contractAlerts(ctx),
      caseStats(ctx),
      db.onboardingTask.findMany({
        where: { organizationId: ctx.orgId, status: "PENDING", mandatory: true },
        select: { employeeId: true, dueDate: true },
      }),
      db.exitRecord.count({ where: { organizationId: ctx.orgId, status: "PENDING" } }),
      db.exitRecord.findMany({
        where: { organizationId: ctx.orgId, status: "APPROVED", tasks: { some: { status: "PENDING", mandatory: true } } },
        select: { id: true },
      }),
      db.exitSettlement.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
      db.employeeDocument.count({
        where: { organizationId: ctx.orgId, expiryDate: { not: null, lte: new Date(Date.now() + 60 * 86400000) } },
      }),
    ]);
  const settlementCount = (s: string) => settlements.find((x) => x.status === s)?._count ?? 0;
  return {
    recruitment,
    contracts: {
      endingSoon: contracts.ending.filter((c) => !c.overdue).length,
      pastEnd: contracts.ending.filter((c) => c.overdue).length,
      probationDue: contracts.probation.filter((c) => !c.overdue).length,
      probationOverdue: contracts.probation.filter((c) => c.overdue).length,
      withoutContract: contracts.noContract.length,
    },
    relations: cases,
    onboarding: {
      employeesIncomplete: new Set(onboarding.map((t) => t.employeeId)).size,
      overdueTasks: onboarding.filter((t) => t.dueDate && t.dueDate < today).length,
    },
    exits: { pendingApproval: exitsPending, clearanceInProgress: exitsActive.length },
    settlements: {
      draft: settlementCount("DRAFT"),
      pendingApproval: settlementCount("PENDING_APPROVAL"),
      approvedNotReleased: settlementCount("APPROVED"),
    },
    expiringDocuments: expiringDocs,
  };
}

/** Everyone with mandatory onboarding steps still open, most overdue first. */
export async function onboardingTracker(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const tasks = await db.onboardingTask.findMany({
    where: { organizationId: ctx.orgId, status: "PENDING" },
    include: { employee: { include: { category: true } } },
    orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }],
  });
  const total = await db.onboardingTask.groupBy({
    by: ["employeeId"],
    where: { organizationId: ctx.orgId, employeeId: { in: [...new Set(tasks.map((t) => t.employeeId))] } },
    _count: true,
  });
  const totals = new Map(total.map((t) => [t.employeeId, t._count]));
  const byEmp = new Map<string, { employee: (typeof tasks)[number]["employee"]; pending: typeof tasks }>();
  for (const t of tasks) {
    const row = byEmp.get(t.employeeId) ?? { employee: t.employee, pending: [] };
    row.pending.push(t);
    byEmp.set(t.employeeId, row);
  }
  return [...byEmp.values()]
    .map((r) => {
      const overdue = r.pending.filter((t) => t.dueDate && t.dueDate < today);
      const nextDue = r.pending.find((t) => t.dueDate)?.dueDate ?? null;
      return {
        employee: r.employee,
        pendingCount: r.pending.length,
        totalCount: totals.get(r.employee.id) ?? r.pending.length,
        overdueCount: overdue.length,
        nextDue,
        tasks: r.pending,
      };
    })
    .sort((a, b) => b.overdueCount - a.overdueCount || b.pendingCount - a.pendingCount);
}

export async function exitTracker(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const exits = await db.exitRecord.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: true, tasks: { select: { status: true, mandatory: true } }, settlement: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return exits.map((e) => ({
    ...e,
    tasksDone: e.tasks.filter((t) => t.status !== "PENDING").length,
    tasksTotal: e.tasks.length,
    mandatoryOpen: e.tasks.filter((t) => t.status === "PENDING" && t.mandatory).length,
  }));
}

export interface TimelineEvent {
  date: Date;
  kind: string;
  title: string;
  detail?: string;
  tone: "blue" | "green" | "amber" | "red" | "slate";
}

/** Everything that has happened to an employee, newest first, drawn from every lifecycle module. */
export async function employeeTimeline(ctx: Ctx, employeeId: string): Promise<TimelineEvent[]> {
  assertCan(ctx, "hr.view");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!emp) return [];
  const [contracts, movements, rates, discipline, cases, leave, exits, settlements, trainings, candidate] =
    await Promise.all([
      db.employmentContract.findMany({ where: { employeeId, organizationId: ctx.orgId } }),
      db.staffMovement.findMany({
        where: { employeeId, organizationId: ctx.orgId, status: "APPROVED" },
        include: { toBeat: true, toClient: true },
      }),
      db.employeePayRate.findMany({ where: { employeeId, organizationId: ctx.orgId } }),
      db.disciplinaryRecord.findMany({ where: { employeeId, organizationId: ctx.orgId, status: "APPROVED" } }),
      db.relationsCase.findMany({ where: { employeeId, organizationId: ctx.orgId } }),
      db.leaveRequest.findMany({ where: { employeeId, organizationId: ctx.orgId, status: "APPROVED" } }),
      db.exitRecord.findMany({ where: { employeeId, organizationId: ctx.orgId } }),
      db.exitSettlement.findMany({ where: { employeeId, organizationId: ctx.orgId } }),
      db.employeeTraining.findMany({ where: { employeeId, organizationId: ctx.orgId, status: { not: "REVOKED" } } }),
      db.candidate.findFirst({ where: { employeeId, organizationId: ctx.orgId } }),
    ]);
  const ev: TimelineEvent[] = [];
  const label = (s: string) => s.replace(/_/g, " ").toLowerCase();
  const seeCases = can(ctx.role, "hr.manage");

  ev.push({
    date: emp.employmentDate,
    kind: "Joined",
    title: "Joined the organization",
    detail: candidate ? `Hired through recruitment (${candidate.candidateNumber})` : undefined,
    tone: "green",
  });
  for (const c of contracts) {
    ev.push({
      date: c.startDate,
      kind: "Contract",
      title: `${c.contractNumber} — ${label(c.type)} contract started`,
      detail: [c.jobTitle, c.endDate ? `ends ${c.endDate.toISOString().slice(0, 10)}` : "open-ended"].join(" · "),
      tone: "blue",
    });
    if (c.probationOutcome && c.probationOutcome !== "PENDING" && c.probationEndDate)
      ev.push({
        date: c.probationEndDate,
        kind: "Probation",
        title: `Probation ${label(c.probationOutcome)}`,
        tone: c.probationOutcome === "CONFIRMED" ? "green" : c.probationOutcome === "FAILED" ? "red" : "amber",
      });
    if (c.terminatedAt)
      ev.push({ date: c.terminatedAt, kind: "Contract", title: `${c.contractNumber} terminated`, detail: c.terminationReason ?? undefined, tone: "slate" });
  }
  for (const m of movements)
    ev.push({
      date: m.effectiveDate,
      kind: "Movement",
      title: `${label(m.movementType)} → ${m.toClient.name} — ${m.toBeat.name}`,
      detail: m.reason,
      tone: "blue",
    });
  for (const r of rates)
    ev.push({ date: r.effectiveFrom, kind: "Pay", title: `Pay rate set to ${Number(r.monthlyGross).toLocaleString("en-NG")} / month`, detail: r.reason, tone: "slate" });
  for (const x of discipline)
    ev.push({
      date: x.incidentDate,
      kind: x.type === "COMMENDATION" ? "Commendation" : "Disciplinary",
      title: label(x.type),
      detail: x.description,
      tone: x.type === "COMMENDATION" ? "green" : "amber",
    });
  if (seeCases)
    for (const c of cases)
      ev.push({
        date: c.openedAt,
        kind: "Relations",
        title: `${c.caseNumber} — ${label(c.type)} case ${label(c.status)}`,
        detail: c.confidential ? "Confidential" : c.summary,
        tone: c.severity === "HIGH" ? "red" : "amber",
      });
  for (const l of leave)
    ev.push({
      date: l.startDate,
      kind: "Leave",
      title: `Annual leave — ${l.workingDays} working day(s)`,
      detail: `${l.startDate.toISOString().slice(0, 10)} to ${l.endDate.toISOString().slice(0, 10)}`,
      tone: "slate",
    });
  for (const t of trainings)
    ev.push({ date: t.issueDate, kind: "Training", title: t.courseName, detail: t.provider ?? undefined, tone: "blue" });
  for (const x of exits) {
    ev.push({
      date: x.noticeDate,
      kind: "Exit",
      title: `${label(x.exitType)} — notice given (${label(x.status)})`,
      detail: x.reason,
      tone: "red",
    });
    if (x.status === "APPROVED")
      ev.push({ date: x.lastWorkingDate, kind: "Exit", title: "Last working day", tone: "red" });
  }
  for (const s of settlements)
    if (s.releasedAt)
      ev.push({
        date: s.releasedAt,
        kind: "Settlement",
        title: `${s.settlementNumber} released to payroll`,
        detail: `Net ${Number(s.netSettlement).toLocaleString("en-NG")}`,
        tone: "slate",
      });
  return ev.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export async function getExitDetail(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const exit = await getExitRecord(ctx, id);
  if (!exit) return null;
  // Uniform & kit still out — only shown to people who may see stock.
  const kit = can(ctx.role, "inventory.view") ? await outstandingKitValue(ctx.orgId, exit.employeeId) : null;
  return { ...exit, kit };
}

async function getExitRecord(ctx: Ctx, id: string) {
  return db.exitRecord.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      employee: {
        include: {
          category: true,
          // Company assets still in the leaver's custody — what "return of company property" is checking.
          assignedFixedAssets: { where: { status: "ACTIVE" }, orderBy: { assetNumber: "asc" } },
        },
      },
      tasks: { orderBy: { sortOrder: "asc" } },
      settlement: true,
    },
  });
}
