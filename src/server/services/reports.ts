import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { db } from "./_base";
import { payrollRuleFor } from "./statutory";

/** Latest non-superseded REGULAR run for a period, or the given run. */
export async function resolveRun(ctx: Ctx, runId?: string) {
  if (runId)
    return db.payrollRun.findFirst({
      where: { id: runId, organizationId: ctx.orgId },
      include: { period: true },
    });
  return db.payrollRun.findFirst({
    where: { organizationId: ctx.orgId, type: "REGULAR", status: { not: "SUPERSEDED" } },
    include: { period: true },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }],
  });
}

// ─────────────────────── Payroll by CLIENT and BEAT ───────────────────────

export interface BeatLine {
  beatId: string | null;
  beatCode: string;
  beatName: string;
  region: string | null;
  headcount: number;
  days: number;
  gross: number;
  overtime: number;
  employerPension: number;
  clientBilling: number;
  managementShare: number;
  /** ITF + NSITF + insurance + uniform&kits + recruitment/training + leave reliever + … (see EmployerCostRule). */
  businessCosts: number;
  margin: number;
  net: number;
}
export interface ClientLine extends Omit<BeatLine, "beatId" | "beatCode" | "beatName" | "region"> {
  clientId: string | null;
  clientName: string;
  beats: BeatLine[];
}

export async function payrollByClientAndBeat(
  ctx: Ctx,
  runId: string,
  clientId?: string,
): Promise<ClientLine[]> {
  const allocs = await db.payrollAllocation.findMany({
    where: { organizationId: ctx.orgId, runId, ...(clientId ? { clientId } : {}) },
    include: { client: true, beat: true },
  });
  const clients = new Map<string, ClientLine>();
  const beatEmp = new Map<string, Set<string>>();
  const clientEmp = new Map<string, Set<string>>();
  for (const a of allocs) {
    const ck = a.clientId ?? "HQ";
    const bk = a.beatId ?? "HQ";
    let c = clients.get(ck);
    if (!c) {
      c = {
        clientId: a.clientId,
        clientName: a.client?.name ?? "Head Office / Unbilled",
        headcount: 0,
        days: 0,
        gross: 0,
        overtime: 0,
        employerPension: 0,
        clientBilling: 0,
        managementShare: 0,
        businessCosts: 0,
        margin: 0,
        net: 0,
        beats: [],
      };
      clients.set(ck, c);
    }
    let b = c.beats.find((x) => (x.beatId ?? "HQ") === bk);
    if (!b) {
      b = {
        beatId: a.beatId,
        beatCode: a.beat?.code ?? "HQ",
        beatName: a.beat?.name ?? "Head Office",
        region: a.beat?.region ?? null,
        headcount: 0,
        days: 0,
        gross: 0,
        overtime: 0,
        employerPension: 0,
        clientBilling: 0,
        managementShare: 0,
        businessCosts: 0,
        margin: 0,
        net: 0,
      };
      c.beats.push(b);
    }
    for (const t of [b, c]) {
      t.days = round2(t.days + num(a.days));
      t.gross = round2(t.gross + num(a.grossAmount));
      t.overtime = round2(t.overtime + num(a.overtimeAmount));
      t.employerPension = round2(t.employerPension + num(a.employerPension));
      t.clientBilling = round2(t.clientBilling + num(a.clientBilling));
      t.managementShare = round2(t.managementShare + num(a.managementShare));
      t.businessCosts = round2(t.businessCosts + num(a.businessCosts));
      t.net = round2(t.net + num(a.netAmount));
    }
    beatEmp.set(`${ck}|${bk}`, (beatEmp.get(`${ck}|${bk}`) ?? new Set()).add(a.employeeId));
    clientEmp.set(ck, (clientEmp.get(ck) ?? new Set()).add(a.employeeId));
  }
  for (const [ck, c] of clients) {
    c.headcount = clientEmp.get(ck)?.size ?? 0;
    c.margin = round2(c.managementShare - c.employerPension - c.businessCosts);
    for (const b of c.beats) {
      b.headcount = beatEmp.get(`${ck}|${b.beatId ?? "HQ"}`)?.size ?? 0;
      b.margin = round2(b.managementShare - b.employerPension - b.businessCosts);
    }
    c.beats.sort((x, y) => x.beatName.localeCompare(y.beatName));
  }
  return [...clients.values()].sort((x, y) => x.clientName.localeCompare(y.clientName));
}

// ─────────────── Payroll by CONTRACT and CATEGORY (billing lines & contract profitability) ───────────────

export interface CategoryLine {
  categoryName: string;
  headcount: number;
  /** Client billing side: quantity × revenueRate = revenue. revenueRate is billed ÷ headcount, so it
   *  always reconciles exactly even when some employees were prorated mid-month. */
  revenue: number;
  revenueRate: number;
  /** Cost side: what the operatives were actually paid (their earned gross), same quantity/blended-rate logic. */
  cost: number;
  costRate: number;
  employerPension: number;
  itf: number;
  nsitf: number;
  nhfMedical: number;
  insurance: number;
  uniformKits: number;
  recruitmentTraining: number;
  leaveReliever: number;
  outsourcingLeaveAllowance: number;
}
export interface ContractLine {
  contractId: string;
  contractNumber: string;
  contractName: string;
  clientId: string;
  clientName: string;
  businessLine: string;
  categories: CategoryLine[];
  revenue: number;
  cost: number;
  employerPension: number;
  itf: number;
  nsitf: number;
  nhfMedical: number;
  insurance: number;
  uniformKits: number;
  recruitmentTraining: number;
  leaveReliever: number;
  outsourcingLeaveAllowance: number;
  otherCosts: number;
}

/** Billing (revenue) and payroll (cost) allocated to every contract, broken down by employee category. */
export async function payrollByContractAndCategory(
  ctx: Ctx,
  runId: string,
  contractId?: string,
): Promise<ContractLine[]> {
  const allocs = await db.payrollAllocation.findMany({
    where: {
      organizationId: ctx.orgId,
      runId,
      contractId: contractId ? contractId : { not: null },
    },
    include: { contract: { include: { client: true } }, record: { select: { categoryName: true } } },
  });
  const contracts = new Map<string, ContractLine>();
  const catEmp = new Map<string, Set<string>>(); // `${contractId}|${category}` -> employee ids
  for (const a of allocs) {
    if (!a.contract) continue;
    const ck = a.contractId!;
    let c = contracts.get(ck);
    if (!c) {
      c = {
        contractId: ck,
        contractNumber: a.contract.contractNumber,
        contractName: a.contract.name,
        clientId: a.contract.clientId,
        clientName: a.contract.client.name,
        businessLine: a.contract.businessLine,
        categories: [],
        revenue: 0,
        cost: 0,
        employerPension: 0,
        itf: 0,
        nsitf: 0,
        nhfMedical: 0,
        insurance: 0,
        uniformKits: 0,
        recruitmentTraining: 0,
        leaveReliever: 0,
        outsourcingLeaveAllowance: 0,
        otherCosts: 0,
      };
      contracts.set(ck, c);
    }
    const categoryName = a.record.categoryName;
    let cat = c.categories.find((x) => x.categoryName === categoryName);
    if (!cat) {
      cat = {
        categoryName,
        headcount: 0,
        revenue: 0,
        revenueRate: 0,
        cost: 0,
        costRate: 0,
        employerPension: 0,
        itf: 0,
        nsitf: 0,
        nhfMedical: 0,
        insurance: 0,
        uniformKits: 0,
        recruitmentTraining: 0,
        leaveReliever: 0,
        outsourcingLeaveAllowance: 0,
      };
      c.categories.push(cat);
    }
    cat.revenue = round2(cat.revenue + num(a.clientBilling));
    cat.cost = round2(cat.cost + num(a.grossAmount));
    for (const k of [
      "employerPension",
      "itf",
      "nsitf",
      "nhfMedical",
      "insurance",
      "uniformKits",
      "recruitmentTraining",
      "leaveReliever",
      "outsourcingLeaveAllowance",
    ] as const) {
      cat[k] = round2(cat[k] + num(a[k]));
      c[k] = round2(c[k] + num(a[k]));
    }
    c.revenue = round2(c.revenue + num(a.clientBilling));
    c.cost = round2(c.cost + num(a.grossAmount));
    const catKey = `${ck}|${categoryName}`;
    catEmp.set(catKey, (catEmp.get(catKey) ?? new Set()).add(a.employeeId));
  }
  for (const c of contracts.values()) {
    c.otherCosts = round2(
      c.employerPension +
        c.itf +
        c.nsitf +
        c.nhfMedical +
        c.insurance +
        c.uniformKits +
        c.recruitmentTraining +
        c.leaveReliever +
        c.outsourcingLeaveAllowance,
    );
    for (const cat of c.categories) {
      cat.headcount = catEmp.get(`${c.contractId}|${cat.categoryName}`)?.size ?? 0;
      cat.revenueRate = cat.headcount ? round2(cat.revenue / cat.headcount) : 0;
      cat.costRate = cat.headcount ? round2(cat.cost / cat.headcount) : 0;
    }
    c.categories.sort((x, y) => x.categoryName.localeCompare(y.categoryName));
  }
  return [...contracts.values()].sort((x, y) => x.contractName.localeCompare(y.contractName));
}

/** Payroll register rows filtered by client / beat (via allocations). */
export async function payrollRegister(
  ctx: Ctx,
  runId: string,
  f: { clientId?: string; beatId?: string } = {},
) {
  let ids: string[] | undefined;
  if (f.clientId || f.beatId) {
    const al = await db.payrollAllocation.findMany({
      where: {
        organizationId: ctx.orgId,
        runId,
        ...(f.clientId ? { clientId: f.clientId } : {}),
        ...(f.beatId ? { beatId: f.beatId } : {}),
      },
      select: { recordId: true },
    });
    ids = [...new Set(al.map((a) => a.recordId))];
  }
  return db.payrollRecord.findMany({
    where: { organizationId: ctx.orgId, runId, ...(ids ? { id: { in: ids } } : {}) },
    include: { allocations: { include: { client: true, beat: true } } },
    orderBy: { employeeNumber: "asc" },
  });
}

// ───────────────────── Beat payroll reconciliation ─────────────────────

export async function beatReconciliation(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) return [];
  const { startDate, endDate } = run.period;
  const [beats, deps, work, allocs] = await Promise.all([
    db.beat.findMany({
      where: { organizationId: ctx.orgId },
      include: { client: true },
      orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
    }),
    db.deployment.findMany({
      where: {
        organizationId: ctx.orgId,
        startDate: { lte: endDate },
        OR: [{ endDate: null }, { endDate: { gte: endDate } }],
      },
    }),
    db.workRegister.findMany({
      where: {
        organizationId: ctx.orgId,
        date: { gte: startDate, lte: endDate },
        attendanceStatus: { in: ["PRESENT", "LATE", "LEAVE", "OFF"] },
      },
      select: { beatId: true, employeeId: true },
    }),
    db.payrollAllocation.findMany({
      where: { organizationId: ctx.orgId, runId },
      select: { beatId: true, employeeId: true, grossAmount: true, overtimeAmount: true },
    }),
  ]);
  return beats.map((b) => {
    const actual = new Set(deps.filter((x) => x.beatId === b.id).map((x) => x.employeeId));
    const worked = new Set(work.filter((x) => x.beatId === b.id).map((x) => x.employeeId));
    const paidAl = allocs.filter((x) => x.beatId === b.id);
    const paid = new Set(paidAl.map((x) => x.employeeId));
    const paidNotAssigned = [...paid].filter((e) => !actual.has(e) && !worked.has(e)).length;
    const flags: string[] = [];
    if (b.approvedStrength !== actual.size) flags.push("Approved Strength ≠ Actual Strength");
    if (worked.size !== paid.size) flags.push("Actual Workers ≠ Payroll Population");
    if (paidNotAssigned) flags.push("Payroll Employee ≠ Location Assignment");
    return {
      clientName: b.client.name,
      beatCode: b.code,
      beatName: b.name,
      bidReference: b.bidReference,
      approvedStrength: b.approvedStrength,
      actualStrength: actual.size,
      employeesWorked: worked.size,
      employeesPaid: paid.size,
      payrollAmount: round2(paidAl.reduce((a, x) => a + num(x.grossAmount) + num(x.overtimeAmount), 0)),
      flags,
    };
  });
}

// ─────────────────────────── Statutory schedules ───────────────────────────

export async function pensionSchedule(ctx: Ctx, runId: string) {
  const recs = await db.payrollRecord.findMany({
    where: { organizationId: ctx.orgId, runId },
    orderBy: [{ pfa: "asc" }, { employeeNumber: "asc" }],
  });
  return recs
    .filter((r) => num(r.employeePension) || num(r.employerPension))
    .map((r) => ({
      pfa: r.pfa ?? "—",
      pensionPin: r.pensionPin ?? "—",
      employeeNumber: r.employeeNumber,
      employeeName: r.employeeName,
      pensionBase: num(r.pensionBase),
      employeePension: num(r.employeePension),
      employerPension: num(r.employerPension),
      total: round2(num(r.employeePension) + num(r.employerPension)),
    }));
}

export async function payeSchedule(ctx: Ctx, runId: string) {
  const recs = await db.payrollRecord.findMany({
    where: { organizationId: ctx.orgId, runId },
    orderBy: { employeeNumber: "asc" },
  });
  return recs.map((r) => ({
    employeeNumber: r.employeeNumber,
    employeeName: r.employeeName,
    taxId: r.taxId ?? "—",
    totalEarnings: num(r.totalEarnings),
    taxableIncome: num(r.taxableIncome),
    paye: num(r.paye),
    taxRuleVersion: r.taxRuleVersion,
  }));
}

export async function bankSchedule(ctx: Ctx, runId: string) {
  const recs = await db.payrollRecord.findMany({
    where: { organizationId: ctx.orgId, runId, netPay: { gt: 0 } },
    orderBy: [{ bankName: "asc" }, { employeeNumber: "asc" }],
  });
  return recs.map((r) => ({
    bankName: r.bankName ?? "—",
    accountNumber: r.accountNumber ?? "—",
    accountName: r.accountName ?? "—",
    employeeNumber: r.employeeNumber,
    employeeName: r.employeeName,
    netPay: num(r.netPay),
  }));
}

/** Employer add-on cost types (see EmployerCostRule) — each gets its own schedule/report/remittance. */
export const EMPLOYER_COST_FIELDS = {
  itf: { label: "ITF (1% of gross salary)", payee: "Industrial Training Fund (ITF)" },
  nsitf: { label: "NSITF-ECA (1% of gross salary)", payee: "Nigeria Social Insurance Trust Fund (NSITF)" },
  nhfMedical: { label: "NHF / Medical", payee: "National Housing Fund / Medical provider" },
  insurance: { label: "Insurance (Group Life)", payee: "Group Life Insurance provider" },
  uniformKits: { label: "Uniform & Kits", payee: "Uniform & Kits supplier" },
  recruitmentTraining: {
    label: "Recruitment, Training & Vetting",
    payee: "Recruitment, Training & Vetting reserve",
  },
  leaveReliever: { label: "Annual Leave Reliever", payee: "Annual Leave Reliever reserve" },
  outsourcingLeaveAllowance: {
    label: "Outsourcing Leave Allowance",
    payee: "Outsourcing Leave Allowance reserve",
  },
} as const;
export type EmployerCostField = keyof typeof EMPLOYER_COST_FIELDS;

export async function employerCostSchedule(ctx: Ctx, runId: string, field: EmployerCostField) {
  const allocations = await db.payrollAllocation.findMany({
    where: { organizationId: ctx.orgId, runId },
    include: { record: true, client: true },
    orderBy: { record: { employeeNumber: "asc" } },
  });
  const byEmployee = new Map<
    string,
    { employeeNumber: string; employeeName: string; clients: Set<string>; amount: number }
  >();
  for (const a of allocations) {
    const amt = num(a[field]);
    if (!amt) continue;
    const cur = byEmployee.get(a.employeeId) ?? {
      employeeNumber: a.record.employeeNumber,
      employeeName: a.record.employeeName,
      clients: new Set<string>(),
      amount: 0,
    };
    cur.amount += amt;
    cur.clients.add(a.client?.name ?? "Head Office");
    byEmployee.set(a.employeeId, cur);
  }
  return [...byEmployee.values()]
    .map((r) => ({
      employeeNumber: r.employeeNumber,
      employeeName: r.employeeName,
      clients: [...r.clients].join("; "),
      amount: round2(r.amount),
    }))
    .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
}

// ─────────────────────────── HR compliance (documents / training) ───────────────────────────

export async function documentsReport(ctx: Ctx) {
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: true },
    orderBy: [{ expiryDate: "asc" }, { employee: { employeeNumber: "asc" } }],
  });
  const today = new Date();
  return rows.map((r) => ({
    employeeNumber: r.employee.employeeNumber,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    documentType: r.documentType.replace(/_/g, " "),
    documentNumber: r.documentNumber ?? "",
    issueDate: r.issueDate ? iso(r.issueDate) : "",
    expiryDate: r.expiryDate ? iso(r.expiryDate) : "",
    status: !r.expiryDate ? "N/A" : r.expiryDate < today ? "EXPIRED" : "VALID",
    fileReference: r.fileReference,
  }));
}

export async function trainingReport(ctx: Ctx) {
  const rows = await db.employeeTraining.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: true },
    orderBy: [{ expiryDate: "asc" }, { employee: { employeeNumber: "asc" } }],
  });
  const today = new Date();
  return rows.map((r) => ({
    employeeNumber: r.employee.employeeNumber,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    courseName: r.courseName,
    provider: r.provider ?? "",
    certificateNumber: r.certificateNumber ?? "",
    issueDate: iso(r.issueDate),
    expiryDate: r.expiryDate ? iso(r.expiryDate) : "",
    status:
      r.status === "REVOKED"
        ? "REVOKED"
        : !r.expiryDate
          ? "VALID"
          : r.expiryDate < today
            ? "EXPIRED"
            : "VALID",
  }));
}

// ─────────────────────────── Variance & profitability ───────────────────────────

export async function payrollVariance(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) return null;
  const prevPeriod = await db.payrollPeriod.findFirst({
    where: {
      organizationId: ctx.orgId,
      OR: [{ year: { lt: run.period.year } }, { year: run.period.year, month: { lt: run.period.month } }],
    },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const prevRun = prevPeriod
    ? await db.payrollRun.findFirst({
        where: { periodId: prevPeriod.id, type: "REGULAR", status: { not: "SUPERSEDED" } },
        orderBy: { runNumber: "desc" },
      })
    : null;
  const [cur, prev] = await Promise.all([
    db.payrollRecord.findMany({ where: { runId } }),
    prevRun ? db.payrollRecord.findMany({ where: { runId: prevRun.id } }) : Promise.resolve([]),
  ]);
  const pm = new Map(prev.map((r) => [r.employeeId, r]));
  const cm = new Map(cur.map((r) => [r.employeeId, r]));
  const rows = [...new Set([...pm.keys(), ...cm.keys()])].map((id) => {
    const c = cm.get(id);
    const p = pm.get(id);
    const cg = num(c?.totalEarnings);
    const pg = num(p?.totalEarnings);
    return {
      employeeNumber: c?.employeeNumber ?? p!.employeeNumber,
      employeeName: c?.employeeName ?? p!.employeeName,
      previousGross: pg,
      currentGross: cg,
      change: round2(cg - pg),
      changePct: pg ? round2(((cg - pg) / pg) * 100) : null,
      status: !p
        ? "JOINER / NEW"
        : !c
          ? "NOT PAID THIS PERIOD"
          : Math.abs(cg - pg) > 0.01
            ? "CHANGED"
            : "UNCHANGED",
    };
  });
  rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return {
    current: run,
    previousPeriod: prevPeriod,
    totals: {
      previousGross: round2(prev.reduce((a, r) => a + num(r.totalEarnings), 0)),
      currentGross: round2(cur.reduce((a, r) => a + num(r.totalEarnings), 0)),
      previousHeadcount: prev.length,
      currentHeadcount: cur.length,
    },
    rows,
  };
}

/**
 * Contribution = Revenue − Payroll − Employer Pension − Other workforce costs (ITF, NSITF,
 * insurance, uniform & kits, recruitment/training, leave reliever / outsourcing leave allowance —
 * see EmployerCostRule; zero for a client with no GUARDING/OUTSOURCING contract).
 */
export async function clientProfitability(ctx: Ctx, runId: string) {
  const lines = await payrollByClientAndBeat(ctx, runId);
  return lines
    .filter((c) => c.clientId)
    .map((c) => {
      const revenue = c.clientBilling;
      const payroll = round2(c.gross + c.overtime);
      const otherCosts = c.businessCosts;
      const contribution = round2(revenue - payroll - c.employerPension - otherCosts);
      return {
        clientName: c.clientName,
        headcount: c.headcount,
        revenue,
        payroll,
        employerPension: c.employerPension,
        otherCosts,
        contribution,
        marginPct: revenue ? round2((contribution / revenue) * 100) : 0,
      };
    });
}

/**
 * Contract profitability — Revenue / Cost / Other Costs / Gross Contribution / Back Office Charges /
 * Net Contribution, broken down by employee category, matching the standard contract P&L layout.
 * Other Costs = employer pension + ITF + NSITF + insurance + uniform&kits + recruitment/training +
 * leave reliever (+ outsourcing leave allowance) — see EmployerCostRule. Back Office Charges is a
 * flat % of revenue (Settings → Payroll Rules).
 */
export async function contractProfitability(ctx: Ctx, runId: string, contractId?: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) return [];
  const [contracts, rules] = await Promise.all([
    payrollByContractAndCategory(ctx, runId, contractId),
    payrollRuleFor(db, ctx.orgId, run.period.endDate),
  ]);
  return contracts.map((c) => {
    const backOfficeCharges = round2((c.revenue * rules.backOfficeChargePct) / 100);
    const grossContribution = round2(c.revenue - c.cost - c.otherCosts);
    const totalCostInclBackOffice = round2(c.cost + c.otherCosts + backOfficeCharges);
    const netContribution = round2(grossContribution - backOfficeCharges);
    return {
      ...c,
      backOfficeChargePct: rules.backOfficeChargePct,
      backOfficeCharges,
      totalDirectCost: c.cost,
      totalOtherCost: c.otherCosts,
      totalCost: round2(c.cost + c.otherCosts),
      totalCostInclBackOffice,
      grossContribution,
      grossContributionPct: c.revenue ? round2((grossContribution / c.revenue) * 100) : 0,
      netContribution,
      netContributionPct: c.revenue ? round2((netContribution / c.revenue) * 100) : 0,
    };
  });
}

// ─────────────────────────── CSV ───────────────────────────

/**
 * A spreadsheet runs a cell that starts with = + - @ (or a tab / carriage return) as a formula, so text
 * someone typed — an account name, a guarantor, a reason — could carry a payload to whoever opens the
 * export. Such text is given a leading apostrophe, which spreadsheets show as plain text. Plain numbers
 * (including negative ones) are left alone.
 */
export function neutralizeFormula(s: string): string {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s}`;
}

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns?: Array<{ key: string; label: string }>,
): string {
  if (!rows.length) return columns ? columns.map((c) => c.label).join(",") : "";
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const raw =
      v instanceof Date
        ? v.toISOString().slice(0, 10)
        : typeof v === "object" && "toNumber" in (v as object)
          ? String(num(v))
          : String(v);
    // numbers the app computed stay numbers; only text can carry a formula
    const s = typeof v === "number" || (typeof v === "object" && "toNumber" in (v as object)) ? raw : neutralizeFormula(raw);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    cols.map((c) => c.label).join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(",")),
  ].join("\n");
}
