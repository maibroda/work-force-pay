import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { raiseCase, resolveCase, closeCase, reopenCase, setCaseStatus } from "@/server/services/relations";
import { approveDisciplinary, raiseDisciplinary, rejectDisciplinary } from "@/server/services/hr";
import { addSuccessionRole, approveSuccessor, rejectSuccessor, setSuccessor, successionOverview } from "@/server/services/succession";
import { appointOfficer, grantFunction, loadGrantPermissions } from "@/server/services/hr-officers";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { isolatedOrg, uid } from "../helpers";

// Governance step 2b (docs/plans/hr-governance-step2-plan.md, built on the recommended answers): the person who did the work does not also sign it off. A case is not closed by the
// person who resolved it; a sanction is not approved by the person who raised it; a new succession nomination is not approved by the person who made it. Where nobody else could,
// the only holder of the right may, with a written reason of at least 20 characters, and the record is flagged "single holder".

const REASON = "I am the only HR administrator in this company.";
const SECRET = "SECRET-SINGLE-REASON only HR administrator here";
const resolution = { outcome: "RESOLVED_INFORMALLY", resolution: "Agreed and settled with the employee." } as never;

async function realUser(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], extra: Record<string, unknown> = {}) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}${uid()}@sp.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", ...extra } });
}
type U = { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null };
const ctxOf = (u: U, grants?: Ctx["grants"]): Ctx => ({ userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId, grants });

/** A company with two HR administrators and a Company Administrator: there is always someone else who could sign off. */
async function world() {
  const t = await isolatedOrg();
  const hrU1 = await realUser(t, "HR_ADMIN");
  const hrU2 = await realUser(t, "HR_ADMIN");
  const bossU = await realUser(t, "COMPANY_ADMIN");
  const hr1 = ctxOf(hrU1);
  const hr2 = ctxOf(hrU2);
  const boss = ctxOf(bossU);
  const emp = await createEmployee(hr1, { firstName: "Gbenga", lastName: "Sp", employmentDate: "2023-01-05", categoryId: t.guardId });
  const successor = await createEmployee(hr1, { firstName: "Tola", lastName: "Next", employmentDate: "2022-01-05", categoryId: t.officeId });
  const grievance = () => raiseCase(hr1, { employeeId: emp.id, type: "GRIEVANCE", summary: "A plain grievance about a rota", description: "Details of the grievance raised." } as never);
  const welfare = () => raiseCase(hr1, { employeeId: emp.id, type: "WELFARE", welfareKind: "BEREAVEMENT", summary: "Bereavement support request", description: "A death in the family, in detail." } as never);
  const sanction = (ctx: Ctx = hr1, type = "WRITTEN_WARNING") => raiseDisciplinary(ctx, { employeeId: emp.id, type, incidentDate: iso(addDays(todayUtc(), -3)), description: "Late to the post three times this month." } as never);
  return { t, hrU1, hrU2, bossU, hr1, hr2, boss, emp, successor, grievance, welfare, sanction };
}

/** A company with exactly one person who holds the HR rights: nobody else could sign off. */
async function solo() {
  const t = await isolatedOrg();
  const hrU = await realUser(t, "HR_ADMIN");
  const hr = ctxOf(hrU);
  const emp = await createEmployee(hr, { firstName: "Gbenga", lastName: "Solo", employmentDate: "2023-01-05", categoryId: t.guardId });
  const successor = await createEmployee(hr, { firstName: "Tola", lastName: "Next", employmentDate: "2022-01-05", categoryId: t.officeId });
  return { t, hrU, hr, emp, successor };
}

describe("closing a case", () => {
  it("a different person closes it: the person who resolved it is refused while someone else could", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, resolution);
    expect((await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } })).resolvedByUserId).toBe(w.hr1.userId);
    await expect(closeCase(w.hr1, c.id)).rejects.toThrow(/resolved this case.*different person/i);
    await expect(closeCase(w.hr1, c.id, { reason: "x".repeat(60) })).rejects.toThrow(/different person/i); // a reason does not help while another holder exists
    const closed = await closeCase(w.hr2, c.id);
    expect(closed).toMatchObject({ status: "CLOSED", closedSingleHolder: false });
    expect((await closeCase(w.boss, (await (async () => { const d = await w.grievance(); await resolveCase(w.hr1, d.id, resolution); return d; })()).id)).status).toBe("CLOSED");
  });
  it("applies to every kind of case, a welfare case included", async () => {
    const w = await world();
    const c = await w.welfare();
    await resolveCase(w.hr1, c.id, resolution);
    await expect(closeCase(w.hr1, c.id)).rejects.toThrow(/different person/i);
    expect((await closeCase(w.hr2, c.id)).status).toBe("CLOSED");
  });
  it("an officer holding the Welfare function cannot close their own resolution while the HR administrator could", async () => {
    const w = await world();
    const u = await realUser(w.t, "EMPLOYEE");
    await appointOfficer(w.boss, u.id, {});
    await grantFunction(w.boss, { userId: u.id, function: "WELFARE", reason: "outsourced HR support" });
    const officer = ctxOf({ ...u, role: "HR_OFFICER" }, await loadGrantPermissions(u.id));
    const c = await w.welfare();
    await resolveCase(officer, c.id, resolution);
    await expect(closeCase(officer, c.id)).rejects.toThrow(/different person/i);
    expect((await closeCase(w.hr1, c.id)).status).toBe("CLOSED");
  });
  it("the only holder may close their own resolution, with a written reason of at least 20 characters, and the case is flagged", async () => {
    const s = await solo();
    const c = await raiseCase(s.hr, { employeeId: s.emp.id, type: "GRIEVANCE", summary: "A plain grievance about a rota", description: "Details of the grievance raised." } as never);
    await resolveCase(s.hr, c.id, resolution);
    await expect(closeCase(s.hr, c.id)).rejects.toThrow(/only person|20 characters/i);
    await expect(closeCase(s.hr, c.id, { reason: "too short" })).rejects.toThrow(/20 characters/i);
    const closed = await closeCase(s.hr, c.id, { reason: REASON });
    expect(closed).toMatchObject({ status: "CLOSED", closedSingleHolder: true, closedSingleReason: REASON });
  });
  it("someone who is not an active holder does not count, and another company’s people never do", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.hrU2.id }, data: { active: false } });
    await db.user.update({ where: { id: w.bossU.id }, data: { active: false } });
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, resolution);
    // the others are switched off: hr1 is now the only holder
    expect((await closeCase(w.hr1, c.id, { reason: REASON })).closedSingleHolder).toBe(true);
    const crowded = await world(); // another company with many holders changes nothing for this one
    expect(crowded.hr2.userId).not.toBe(w.hr1.userId);
  });
  it("re-opening clears who resolved it, so the earlier resolver can close what someone else resolves next", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, resolution);
    await closeCase(w.hr2, c.id);
    await reopenCase(w.hr2, c.id, "New evidence has come to light.");
    expect((await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } })).resolvedByUserId).toBeNull();
    await resolveCase(w.hr2, c.id, resolution);
    expect((await closeCase(w.hr1, c.id)).status).toBe("CLOSED");
  });
  it("a case resolved before this rule has no recorded resolver, so the rule does not apply to it", async () => {
    const w = await world();
    const c = await w.grievance();
    await resolveCase(w.hr1, c.id, resolution);
    await db.relationsCase.update({ where: { id: c.id }, data: { resolvedByUserId: null } });
    expect(await closeCase(w.hr1, c.id)).toMatchObject({ status: "CLOSED", closedSingleHolder: false });
  });
  it("is recorded by ids and the flag, never the reason", async () => {
    const s = await solo();
    const c = await raiseCase(s.hr, { employeeId: s.emp.id, type: "GRIEVANCE", summary: "A plain grievance about a rota", description: "Details of the grievance raised." } as never);
    await resolveCase(s.hr, c.id, resolution);
    await closeCase(s.hr, c.id, { reason: SECRET });
    const rows = await db.auditLog.findMany({ where: { organizationId: s.t.org.id, action: "RELATIONS_CASE_CLOSE" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
    expect(rows[0].newValue).toMatchObject({ closedSingleHolder: true });
  });
});

describe("approving a sanction", () => {
  it("is not done by the person who raised it while someone else could", async () => {
    const w = await world();
    const s = await w.sanction(w.hr1);
    expect(s.issuedByUserId).toBe(w.hr1.userId);
    await expect(approveDisciplinary(w.hr1, s.id)).rejects.toThrow(/raised this sanction.*different person|different person/i);
    const done = await approveDisciplinary(w.hr2, s.id);
    expect(done).toMatchObject({ status: "APPROVED", approvedByUserId: w.hr2.userId, approvedSingleHolder: false });
    const t2 = await w.sanction(w.hr2);
    expect((await approveDisciplinary(w.boss, t2.id)).status).toBe("APPROVED");
  });
  it("the only holder may approve their own, with a written reason of at least 20 characters, and the record is flagged", async () => {
    const s = await solo();
    const rec = await raiseDisciplinary(s.hr, { employeeId: s.emp.id, type: "VERBAL_WARNING", incidentDate: iso(addDays(todayUtc(), -2)), description: "Left the post early without cover." } as never);
    await expect(approveDisciplinary(s.hr, rec.id)).rejects.toThrow(/only person|20 characters/i);
    const done = await approveDisciplinary(s.hr, rec.id, undefined, { reason: REASON });
    expect(done).toMatchObject({ status: "APPROVED", approvedSingleHolder: true, approvedSingleReason: REASON });
  });
  it("praise (a commendation) is unchanged: the person who raised it may approve it", async () => {
    const w = await world();
    const c = await w.sanction(w.hr1, "COMMENDATION");
    expect((await approveDisciplinary(w.hr1, c.id)).status).toBe("APPROVED");
  });
  it("a record raised before this rule has no recorded raiser, so the rule does not apply to it", async () => {
    const w = await world();
    const s = await w.sanction(w.hr1);
    await db.disciplinaryRecord.update({ where: { id: s.id }, data: { issuedByUserId: null } });
    expect((await approveDisciplinary(w.hr1, s.id)).status).toBe("APPROVED");
  });
  it("rejecting is unchanged, and the audit log carries the flag and never the reason", async () => {
    const w = await world();
    const s = await w.sanction(w.hr1);
    expect((await rejectDisciplinary(w.hr1, s.id, "Raised in error, withdrawing it.")).status).toBe("REJECTED");
    const so = await solo();
    const rec = await raiseDisciplinary(so.hr, { employeeId: so.emp.id, type: "WRITTEN_WARNING", incidentDate: iso(addDays(todayUtc(), -2)), description: "Left the post early without cover." } as never);
    await approveDisciplinary(so.hr, rec.id, undefined, { reason: SECRET });
    const rows = await db.auditLog.findMany({ where: { organizationId: so.t.org.id, action: "DISCIPLINARY_RECORD_APPROVE" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
    expect(rows[0].newValue).toMatchObject({ approvedSingleHolder: true });
  });
});

describe("a new succession nomination", () => {
  const nominate = async (ctx: Ctx, w: { t: { guardId: string }; successor: { id: string } }, roleId: string, extra: Record<string, unknown> = {}) =>
    setSuccessor(ctx, { roleId, employeeId: w.successor.id, readiness: "READY_NOW", ...extra } as never);

  it("is proposed, does not count, and is approved by a different holder", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await nominate(w.hr1, w, role.id);
    expect(c).toMatchObject({ status: "PROPOSED", proposedByUserId: w.hr1.userId });
    const before = (await successionOverview(w.hr1)).find((r) => r.id === role.id)!;
    expect(before.covered).toBe(false);
    expect(before.candidates[0]).toMatchObject({ status: "PROPOSED" });
    await expect(approveSuccessor(w.hr1, c.id)).rejects.toThrow(/proposed this nomination.*different person|different person/i);
    const done = await approveSuccessor(w.hr2, c.id);
    expect(done).toMatchObject({ status: "APPROVED", decidedByUserId: w.hr2.userId, singleHolder: false });
    expect((await successionOverview(w.hr1)).find((r) => r.id === role.id)!.covered).toBe(true);
  });
  it("is approved only by a holder of the succession function: not the Company Administrator, the auditor or anyone else", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await nominate(w.hr1, w, role.id);
    await expect(approveSuccessor(w.boss, c.id)).rejects.toThrow(/permission/);
    await expect(approveSuccessor(w.t.ctx("AUDITOR"), c.id)).rejects.toThrow(/permission/);
  });
  it("an officer holding the Succession function is a holder and can approve", async () => {
    const w = await world();
    const u = await realUser(w.t, "EMPLOYEE");
    await appointOfficer(w.boss, u.id, {});
    await grantFunction(w.boss, { userId: u.id, function: "SUCCESSION", reason: "keeps the succession list" });
    const officer = ctxOf({ ...u, role: "HR_OFFICER" }, await loadGrantPermissions(u.id));
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await nominate(w.hr1, w, role.id);
    expect((await approveSuccessor(officer, c.id)).status).toBe("APPROVED");
  });
  it("can be rejected by a holder or withdrawn by the person who proposed it, and is then gone", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await nominate(w.hr1, w, role.id);
    await rejectSuccessor(w.hr1, c.id); // withdrawn by the proposer
    expect(await db.successionCandidate.count({ where: { id: c.id } })).toBe(0);
    const d = await nominate(w.hr1, w, role.id);
    await rejectSuccessor(w.hr2, d.id);
    expect(await db.successionCandidate.count({ where: { roleId: role.id } })).toBe(0);
  });
  it("the only holder may add a successor straight away, with a written reason of at least 20 characters, and it is flagged", async () => {
    const s = await solo();
    const role = await addSuccessionRole(s.hr, s.t.guardId);
    await expect(setSuccessor(s.hr, { roleId: role.id, employeeId: s.successor.id, readiness: "READY_NOW" } as never)).rejects.toThrow(/only person|20 characters/i);
    const c = await setSuccessor(s.hr, { roleId: role.id, employeeId: s.successor.id, readiness: "READY_NOW", singleHolderReason: REASON } as never);
    expect(c).toMatchObject({ status: "APPROVED", singleHolder: true, singleReason: REASON });
    expect((await successionOverview(s.hr)).find((r) => r.id === role.id)!.covered).toBe(true);
  });
  it("changing the readiness of an approved successor stays immediate, and every row from before this rule is approved", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const old = await db.successionCandidate.create({ data: { organizationId: w.t.org.id, roleId: role.id, employeeId: w.successor.id, readiness: "READY_3_PLUS", createdBy: "before" } });
    expect(old.status).toBe("APPROVED"); // the database default: existing successors keep counting
    const changed = await setSuccessor(w.hr1, { roleId: role.id, employeeId: w.successor.id, readiness: "READY_NOW" } as never);
    expect(changed).toMatchObject({ status: "APPROVED", readiness: "READY_NOW" });
  });
  it("is recorded by ids, the step and the flag, never the reason", async () => {
    const w = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await nominate(w.hr1, w, role.id);
    await approveSuccessor(w.hr2, c.id);
    const so = await solo();
    const r2 = await addSuccessionRole(so.hr, so.t.guardId);
    await setSuccessor(so.hr, { roleId: r2.id, employeeId: so.successor.id, readiness: "READY_NOW", singleHolderReason: SECRET } as never);
    const a = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SUCCESSION_SUCCESSOR" } } });
    expect(a.map((r) => r.action).sort()).toEqual(["SUCCESSION_SUCCESSOR_APPROVE", "SUCCESSION_SUCCESSOR_PROPOSE"]);
    const b = await db.auditLog.findMany({ where: { organizationId: so.t.org.id, action: { startsWith: "SUCCESSION_SUCCESSOR" } } });
    expect(JSON.stringify(b)).not.toMatch(/SECRET/);
    expect(JSON.stringify(b)).toMatch(/singleHolder/);
  });
});

describe("privacy and isolation", () => {
  it("erasing an employee removes the reasons (the shape stays)", async () => {
    const s = await solo();
    const c = await raiseCase(s.hr, { employeeId: s.emp.id, type: "GRIEVANCE", summary: "A plain grievance about a rota", description: "Details of the grievance raised." } as never);
    await resolveCase(s.hr, c.id, resolution);
    await closeCase(s.hr, c.id, { reason: SECRET });
    const rec = await raiseDisciplinary(s.hr, { employeeId: s.emp.id, type: "WRITTEN_WARNING", incidentDate: iso(addDays(todayUtc(), -2)), description: "Left the post early without cover." } as never);
    await approveDisciplinary(s.hr, rec.id, undefined, { reason: SECRET });
    const role = await addSuccessionRole(s.hr, s.t.guardId);
    await setSuccessor(s.hr, { roleId: role.id, employeeId: s.successor.id, readiness: "READY_NOW", singleHolderReason: SECRET } as never);
    await db.$transaction((tx) => anonymizeEmployee(tx, s.t.org.id, s.emp.id, new Date()));
    await db.$transaction((tx) => anonymizeEmployee(tx, s.t.org.id, s.successor.id, new Date()));
    const after = JSON.stringify([
      await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } }),
      await db.disciplinaryRecord.findUniqueOrThrow({ where: { id: rec.id } }),
      await db.successionCandidate.findMany({ where: { roleId: role.id } }),
    ]);
    expect(after).not.toMatch(/SECRET/);
    expect(await db.relationsCase.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "CLOSED", closedSingleHolder: true });
  });
  it("another company’s administrator cannot approve, reject or close here", async () => {
    const w = await world();
    const other = await world();
    const role = await addSuccessionRole(w.hr1, w.t.guardId);
    const c = await setSuccessor(w.hr1, { roleId: role.id, employeeId: w.successor.id, readiness: "READY_NOW" } as never);
    await expect(approveSuccessor(other.hr1, c.id)).rejects.toThrow(/not found/i);
    await expect(rejectSuccessor(other.hr2, c.id)).rejects.toThrow(/not found/i);
    const s = await w.sanction(w.hr1);
    await expect(approveDisciplinary(other.hr1, s.id)).rejects.toThrow(/not found/i);
  });
});

describe("a case still has to be worked before it is closed", () => {
  it("nothing here changes who may resolve, and a case that is not resolved cannot be closed", async () => {
    const w = await world();
    const c = await w.grievance();
    await expect(closeCase(w.hr2, c.id)).rejects.toThrow(/resolve/i);
    await setCaseStatus(w.hr1, c.id, "INVESTIGATING");
    await resolveCase(w.hr2, c.id, resolution);
    expect((await closeCase(w.hr1, c.id)).status).toBe("CLOSED"); // resolved by hr2, closed by hr1
  });
});
