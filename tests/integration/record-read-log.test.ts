import { describe, expect, it, vi, type Mock } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { raiseCase, getCase, listCases } from "@/server/services/relations";
import { employeeTimeline } from "@/server/services/hr-overview";
import { addSuccessionRole, setSuccessor, successionOverview } from "@/server/services/succession";
import { createPlan, getPlan, listPlans, myPlans } from "@/server/services/pip";
import { appointOfficer, grantFunction, loadGrantPermissions } from "@/server/services/hr-officers";
import { SENSITIVE_VIEW, sensitiveAccessLog } from "@/server/services/sensitive-access";
import { isolatedOrg, uid } from "../helpers";

// The audit log is only as good as the reads it records. Governance step 2a (docs/plans/hr-governance-step2-plan.md, built on the recommended answers): reading a welfare, confidential
// or disciplinary case, the succession list or an improvement plan writes an entry: who, when, the kind and the RECORD's own id; never the content, and never the employee, so the
// log cannot reveal that a named person has a welfare case. The service that reads records it, so every page is covered. Not recording is not an option: if the entry cannot be
// written, the read fails.

// every call to the audit writer goes through this wrapper, so a test can make one write fail
vi.mock("@/server/services/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/audit")>();
  return { ...mod, logAudit: vi.fn(mod.logAudit) };
});
import { logAudit } from "@/server/services/audit";

const NAME = "Zainab Hiddenname";
const SECRET = "SECRET-CASE-TEXT a death in the family";

async function realUser(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], extra: Record<string, unknown> = {}) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}${uid()}@rl.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", ...extra } });
}
const ctxOf = (u: { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null }, grants?: Ctx["grants"]): Ctx => ({ userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId, grants });

async function world() {
  const t = await isolatedOrg();
  const hrUser = await realUser(t, "HR_ADMIN");
  const hr = ctxOf(hrUser);
  const boss = ctxOf(await realUser(t, "COMPANY_ADMIN"));
  const auditor = t.ctx("AUDITOR");
  const emp = await createEmployee(hr, { firstName: "Zainab", lastName: "Hiddenname", employmentDate: "2023-01-05", categoryId: t.guardId });
  const successor = await createEmployee(hr, { firstName: "Tola", lastName: "Successor", employmentDate: "2022-01-05", categoryId: t.officeId });
  const base = { employeeId: emp.id, description: `${SECRET} in detail` };
  const welfare = await raiseCase(hr, { ...base, type: "WELFARE", welfareKind: "BEREAVEMENT", summary: `Welfare ${SECRET}` } as never);
  const harassment = await raiseCase(hr, { ...base, type: "HARASSMENT", summary: "A harassment concern about conduct" } as never);
  const misconduct = await raiseCase(hr, { ...base, type: "MISCONDUCT", summary: "Misconduct allegation at the post" } as never);
  const grievance = await raiseCase(hr, { ...base, type: "GRIEVANCE", summary: "A plain grievance about a rota" } as never);
  const entries = () => db.auditLog.findMany({ where: { organizationId: t.org.id, action: SENSITIVE_VIEW }, orderBy: { createdAt: "asc" } });
  return { t, hr, hrUser, boss, auditor, emp, successor, welfare, harassment, misconduct, grievance, entries };
}

describe("one case read on its own", () => {
  it("a welfare case writes one entry: who, the kind and the case's own id; no employee and no text", async () => {
    const w = await world();
    await getCase(w.hr, w.welfare.id);
    const rows = await w.entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: w.hr.userId, entity: "RelationsCase", entityId: w.welfare.id });
    expect(rows[0].newValue).toMatchObject({ kind: "WELFARE_CASE" });
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${NAME}|Zainab|Hiddenname|SECRET|death in the family|${w.emp.id}`));
  });
  it("opening the same case again within ten minutes is one entry", async () => {
    const w = await world();
    await getCase(w.hr, w.welfare.id);
    await getCase(w.hr, w.welfare.id);
    expect(await w.entries()).toHaveLength(1);
  });
  it("tells the kinds apart: misconduct is disciplinary, harassment is confidential, a plain grievance is not recorded", async () => {
    const w = await world();
    await getCase(w.hr, w.misconduct.id);
    await getCase(w.hr, w.harassment.id);
    await getCase(w.hr, w.grievance.id);
    const kinds = (await w.entries()).map((r) => (r.newValue as { kind: string }).kind).sort();
    expect(kinds).toEqual(["CONFIDENTIAL_CASE", "DISCIPLINARY_CASE"]);
  });
  it("a read that shows nothing is not a read: the auditor sees a confidential case exist, not its content, so nothing is recorded", async () => {
    const w = await world();
    const seen = await getCase(w.auditor, w.harassment.id);
    expect(seen).toMatchObject({ redacted: true });
    expect(await w.entries()).toHaveLength(0);
  });
  it("looking at a case about yourself is not recorded", async () => {
    const w = await world();
    await getCase({ ...w.hr, employeeId: w.emp.id }, w.welfare.id);
    expect(await w.entries()).toHaveLength(0);
  });
});

describe("a list of cases", () => {
  it("records how many of each kind were shown with their content, never who they are about", async () => {
    const w = await world();
    await listCases(w.hr, {});
    const rows = await w.entries();
    const byKind = Object.fromEntries(rows.map((r) => [(r.newValue as { kind: string }).kind, (r.newValue as { count: number }).count]));
    expect(byKind).toEqual({ WELFARE_CASE: 1, CONFIDENTIAL_CASE: 1, DISCIPLINARY_CASE: 1 });
    for (const r of rows) expect(r.entity).toBe("SensitiveList");
    expect(JSON.stringify(rows)).not.toMatch(/Zainab|Hiddenname|SECRET/);
  });
  it("a list shows the reader only what they may read, so only that is recorded: the auditor sees a disciplinary case's summary, not a welfare case or a confidential one", async () => {
    const w = await world();
    await listCases(w.auditor, {});
    const kinds = (await w.entries()).map((r) => (r.newValue as { kind: string }).kind);
    expect(kinds).toEqual(["DISCIPLINARY_CASE"]);
  });
});

describe("an employee's HR history", () => {
  it("shows each case's number, type and status, so it records the cases it showed, by id, and not a plain grievance", async () => {
    const w = await world();
    const events = await employeeTimeline(w.hr, w.emp.id);
    expect(events.filter((e) => e.kind === "Relations")).toHaveLength(4);
    const rows = await w.entries();
    expect(rows.map((r) => (r.newValue as { kind: string }).kind).sort()).toEqual(["CONFIDENTIAL_CASE", "DISCIPLINARY_CASE", "WELFARE_CASE"]);
    expect(rows.map((r) => r.entityId).sort()).toEqual([w.welfare.id, w.harassment.id, w.misconduct.id].sort());
    for (const r of rows) expect(r.entity).toBe("RelationsCase");
    expect(JSON.stringify(rows)).not.toMatch(/Zainab|Hiddenname|SECRET/);
  });
  it("shows the auditor no cases and so records nothing", async () => {
    const w = await world();
    await employeeTimeline(w.auditor, w.emp.id);
    expect(await w.entries()).toHaveLength(0);
  });
});

describe("the succession list and improvement plans", () => {
  it("opening the succession list records one entry with how many successors were shown", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr, w.t.guardId);
    await setSuccessor(w.hr, { roleId: role.id, employeeId: w.successor.id, readiness: "READY_NOW", singleHolderReason: "The only holder of the succession function here." } as never);
    await successionOverview(w.hr);
    const rows = await w.entries();
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ kind: "SUCCESSION", count: 1 });
    expect(JSON.stringify(rows)).not.toMatch(/Tola|Successor/);
  });
  it("a plan read on its own records the plan's id; a list records a count; the employee's own view records nothing", async () => {
    const w = await world();
    const owner = await realUser(w.t, "HR_ADMIN");
    const plan = await createPlan(w.hr, { employeeId: w.emp.id, concerns: "PIP-CONCERN arrives late to the post", startDate: iso(addDays(todayUtc(), -5)), ownerUserId: owner.id } as never);
    await getPlan(w.hr, plan.id);
    await listPlans(w.hr, {});
    const rows = (await w.entries()).filter((r) => (r.newValue as { kind: string }).kind === "IMPROVEMENT_PLAN");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.entity === "PerformanceImprovementPlan")).toMatchObject({ entityId: plan.id });
    expect(rows.find((r) => r.entity === "SensitiveList")!.newValue).toMatchObject({ count: 1 });
    expect(JSON.stringify(rows)).not.toMatch(/PIP-CONCERN|Zainab/);
    const before = (await w.entries()).length;
    const me = ctxOf(await realUser(w.t, "EMPLOYEE", { employeeId: w.emp.id }));
    await myPlans(me);
    expect((await w.entries()).length).toBe(before);
  });
});

describe("an outsourced officer", () => {
  it("is recorded like anyone else, and marked as outsourced", async () => {
    const w = await world();
    const u = await realUser(w.t, "EMPLOYEE");
    await appointOfficer(w.boss, u.id, { external: true, accessEndsOn: iso(addDays(todayUtc(), 30)) });
    await grantFunction(w.boss, { userId: u.id, function: "WELFARE", reason: "outsourced HR support" });
    const officer = ctxOf({ ...u, role: "HR_OFFICER" }, await loadGrantPermissions(u.id));
    await getCase(officer, w.welfare.id);
    const [row] = await w.entries();
    expect(row).toMatchObject({ userId: u.id, entityId: w.welfare.id });
    expect(row.newValue).toMatchObject({ kind: "WELFARE_CASE", external: true });
    // an employee of the company who is not outsourced carries no such mark
    const w2 = await world();
    await getCase(w2.hr, w2.welfare.id);
    expect((await w2.entries())[0].newValue).not.toHaveProperty("external");
  });
});

describe("what the auditor sees", () => {
  it("names who read what by the record's reference: the case number, never the employee, never the text", async () => {
    const w = await world();
    await getCase(w.hr, w.welfare.id);
    await getCase(w.hr, w.harassment.id);
    await listCases(w.hr, {});
    const log = await sensitiveAccessLog(w.auditor, {});
    const single = log.entries.filter((e) => e.ref === null || e.reference);
    expect(log.entries.length).toBeGreaterThanOrEqual(5);
    const welfareRow = log.entries.find((e) => e.kind === "WELFARE_CASE" && e.reference === w.welfare.caseNumber);
    expect(welfareRow).toBeTruthy();
    expect(welfareRow!.employee).toBeNull();
    expect(single.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toMatch(/Zainab|Hiddenname|SECRET|death in the family/);
    expect(log.summary.find((s) => s.userId === w.hr.userId)).toMatchObject({ records: 2 });
  });
  it("lists an outsourced reader first", async () => {
    const w = await world();
    const u = await realUser(w.t, "EMPLOYEE");
    await appointOfficer(w.boss, u.id, { external: true, accessEndsOn: iso(addDays(todayUtc(), 30)) });
    await grantFunction(w.boss, { userId: u.id, function: "WELFARE", reason: "outsourced HR support" });
    await getCase(w.hr, w.welfare.id);
    await getCase(w.hr, w.harassment.id);
    await getCase(w.hr, w.misconduct.id);
    await getCase(ctxOf({ ...u, role: "HR_OFFICER" }, await loadGrantPermissions(u.id)), w.welfare.id);
    const log = await sensitiveAccessLog(w.auditor, {});
    expect(log.summary[0]).toMatchObject({ userId: u.id, external: true });
  });
  it("another company's auditor sees none of it", async () => {
    const w = await world();
    await getCase(w.hr, w.welfare.id);
    const other = await world();
    const theirs = await sensitiveAccessLog(other.auditor, {});
    expect(theirs.entries).toEqual([]);
  });
});

describe("not recording is not an option", () => {
  it("if the entry cannot be written, the read fails and shows nothing", async () => {
    const w = await world();
    (logAudit as Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(getCase(w.hr, w.welfare.id)).rejects.toThrow(/disk full/);
    expect(await w.entries()).toHaveLength(0);
  });
});
