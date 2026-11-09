import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { feedbackForAppraisal, giveFeedback, listFeedback, myFeedback, replyToFeedback, voidFeedback } from "@/server/services/feedback";
import { isolatedOrg, uid } from "../helpers";

// Performance management, step (c): continuous feedback (the founder's go of 2026-11-07; plan docs/plans/continuous-feedback-plan.md).
// Recommended answers were used: the employee always sees it, the reporting manager and HR give it, direct reports only, the auditor does not read it,
// entries are voided by HR with a reason (never edited), and it is read-only evidence on an appraisal (never a score).

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@fb.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

/** HR, a supervisor who manages two guards, another supervisor who manages a third, and the guards themselves with logins. */
async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2022-01-01", categoryId: t.officeId });
  const sup2Emp = await createEmployee(hr, { firstName: "Tunde", lastName: "Other", employmentDate: "2022-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const sup2 = await login(t, "SUPERVISOR", sup2Emp.id);
  const g1 = await createEmployee(hr, { firstName: "Gbenga", lastName: "One", employmentDate: "2023-01-01", categoryId: t.guardId, reportingManagerId: supEmp.id });
  const g2 = await createEmployee(hr, { firstName: "Hauwa", lastName: "Two", employmentDate: "2023-01-01", categoryId: t.guardId, reportingManagerId: supEmp.id });
  const g3 = await createEmployee(hr, { firstName: "Ife", lastName: "Three", employmentDate: "2023-01-01", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  const noMgr = await createEmployee(hr, { firstName: "Obi", lastName: "Loose", employmentDate: "2023-01-01", categoryId: t.guardId });
  const me1 = await login(t, "EMPLOYEE", g1.id);
  const me2 = await login(t, "EMPLOYEE", g2.id);
  const praise = (ctx: Ctx, employeeId: string, over: Record<string, unknown> = {}) => giveFeedback(ctx, { employeeId, kind: "RECOGNITION", body: "SECRET-PRAISE stayed on to hand over the keys", ...over } as never);
  return { t, hr, supEmp, sup, sup2, g1, g2, g3, noMgr, me1, me2, praise };
}

describe("giving feedback", () => {
  it("a manager gives it about a direct report: the kind, the text, the date and who wrote it are recorded", async () => {
    const w = await world();
    const f = await w.praise(w.sup, w.g1.id, { relatesOn: day(-2) });
    expect(f).toMatchObject({ employeeId: w.g1.id, kind: "RECOGNITION", authorUserId: w.sup.userId, authorEmployeeId: w.supEmp.id, voidedAt: null, employeeReply: null });
    expect(f.relatesOn.toISOString().slice(0, 10)).toBe(day(-2));
    const coaching = await giveFeedback(w.sup, { employeeId: w.g1.id, kind: "COACHING", body: "Two incident reports were missing times: use the template" });
    expect(coaching.relatesOn.toISOString().slice(0, 10)).toBe(day(0)); // today unless said otherwise
  });
  it("HR gives it about anyone; a manager only about their own direct reports, and for anyone else the answer is only 'not found'", async () => {
    const w = await world();
    await expect(w.praise(w.hr, w.g3.id)).resolves.toMatchObject({ employeeId: w.g3.id });
    await expect(w.praise(w.hr, w.noMgr.id)).resolves.toMatchObject({ employeeId: w.noMgr.id });
    await expect(w.praise(w.sup, w.g3.id)).rejects.toThrow(/employee not found/i); // another manager's report
    await expect(w.praise(w.sup, w.noMgr.id)).rejects.toThrow(/employee not found/i); // nobody's report
    await expect(w.praise(w.sup, "does-not-exist")).rejects.toThrow(/employee not found/i);
    const other = await world();
    await expect(w.praise(w.hr, other.g1.id)).rejects.toThrow(/employee not found/i); // another company's employee
  });
  it("nobody gives it about themselves, HR included", async () => {
    const w = await world();
    await expect(w.praise(w.sup, w.supEmp.id)).rejects.toThrow(/yourself/i);
    const hrEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Hr", employmentDate: "2022-01-01", categoryId: w.t.officeId });
    const hrWithRecord = await login(w.t, "HR_ADMIN", hrEmp.id);
    await expect(w.praise(hrWithRecord, hrEmp.id)).rejects.toThrow(/yourself/i);
  });
  it("needs a real note, a valid kind, a date that is not in the future, and an employee who is still active", async () => {
    const w = await world();
    await expect(w.praise(w.sup, w.g1.id, { body: "ok" })).rejects.toThrow();
    await expect(w.praise(w.sup, w.g1.id, { body: "x".repeat(1001) })).rejects.toThrow();
    await expect(w.praise(w.sup, w.g1.id, { kind: "GOSSIP" })).rejects.toThrow();
    await expect(w.praise(w.sup, w.g1.id, { relatesOn: day(3) })).rejects.toThrow(/future/i);
    await db.employee.update({ where: { id: w.g2.id }, data: { status: "RESIGNED" } });
    await expect(w.praise(w.sup, w.g2.id)).rejects.toThrow(/no longer active/i);
  });
  it("only roles that give feedback can: finance, payroll, the auditor, the employee and operations-less roles are refused", async () => {
    const w = await world();
    for (const role of ["FINANCE", "PAYROLL_ADMIN", "AUDITOR", "EMPLOYEE"] as const) {
      const c = await login(w.t, role);
      await expect(w.praise(c, w.g1.id), role).rejects.toThrow(/permission/);
    }
    const opsEmp = await createEmployee(w.hr, { firstName: "Ope", lastName: "Manager", employmentDate: "2022-01-01", categoryId: w.t.officeId });
    const opsGuard = await createEmployee(w.hr, { firstName: "Kemi", lastName: "Guard", employmentDate: "2023-01-01", categoryId: w.t.guardId, reportingManagerId: opsEmp.id });
    const ops = await login(w.t, "OPERATIONS", opsEmp.id);
    await expect(w.praise(ops, opsGuard.id)).resolves.toBeTruthy(); // an operations manager can, about their own direct report
    await expect(w.praise(ops, w.g1.id)).rejects.toThrow(/employee not found/i); // not about someone else's
  });
});

describe("reading feedback", () => {
  it("HR reads everyone's; a manager reads only their own direct reports'; others are refused", async () => {
    const w = await world();
    const a = await w.praise(w.sup, w.g1.id);
    const b = await w.praise(w.sup2, w.g3.id);
    expect((await listFeedback(w.hr, {})).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await listFeedback(w.sup, {})).map((x) => x.id)).toEqual([a.id]);
    expect((await listFeedback(w.sup2, {})).map((x) => x.id)).toEqual([b.id]);
    for (const role of ["FINANCE", "AUDITOR", "EMPLOYEE", "PAYROLL_ADMIN"] as const) await expect(listFeedback(await login(w.t, role), {}), role).rejects.toThrow(/permission/);
  });
  it("HR can narrow by employee, kind and dates, and see the team view as a manager would", async () => {
    const w = await world();
    const old = await w.praise(w.hr, w.g1.id, { relatesOn: day(-40) });
    const recent = await w.praise(w.hr, w.g1.id, { relatesOn: day(-1) });
    const coaching = await giveFeedback(w.hr, { employeeId: w.g2.id, kind: "COACHING", body: "Arrives a few minutes late to post", relatesOn: day(-1) });
    expect((await listFeedback(w.hr, { employeeId: w.g1.id })).map((x) => x.id).sort()).toEqual([old.id, recent.id].sort());
    expect((await listFeedback(w.hr, { kind: "COACHING" })).map((x) => x.id)).toEqual([coaching.id]);
    expect((await listFeedback(w.hr, { from: day(-10), to: day(0) })).map((x) => x.id).sort()).toEqual([recent.id, coaching.id].sort());
    const hrManagerEmp = await createEmployee(w.hr, { firstName: "Mgr", lastName: "Hr", employmentDate: "2022-01-01", categoryId: w.t.officeId });
    const hrAsManager = await login(w.t, "HR_ADMIN", hrManagerEmp.id);
    expect(await listFeedback(hrAsManager, { scope: "team" })).toEqual([]); // the team view is only one's own direct reports, even for HR
    await db.employee.update({ where: { id: w.g3.id }, data: { reportingManagerId: hrManagerEmp.id } });
    const mine = await w.praise(w.hr, w.g3.id);
    expect((await listFeedback(hrAsManager, { scope: "team" })).map((x) => x.id)).toEqual([mine.id]);
  });
  it("another company sees nothing", async () => {
    const w = await world();
    await w.praise(w.sup, w.g1.id);
    const o = await world();
    expect(await listFeedback(o.hr, {})).toEqual([]);
    expect(await listFeedback(o.sup, {})).toEqual([]);
  });
});

describe("the employee's own view", () => {
  it("the employee sees everything recorded about them, never anyone else's, and who wrote it", async () => {
    const w = await world();
    const mine = await w.praise(w.sup, w.g1.id);
    await w.praise(w.sup, w.g2.id);
    const rows = await myFeedback(w.me1);
    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({ kind: "RECOGNITION", authorName: w.sup.name, reply: null });
    expect(rows[0].body).toContain("SECRET-PRAISE");
    expect(await myFeedback(await login(w.t, "FINANCE"))).toEqual([]); // no employee record
  });
  it("replies once to an entry about them, and only to their own", async () => {
    const w = await world();
    const f = await giveFeedback(w.sup, { employeeId: w.g1.id, kind: "COACHING", body: "Two incident reports were missing times" });
    await expect(replyToFeedback(w.me2, f.id, "That is not mine to answer")).rejects.toThrow(/not found/i);
    await expect(replyToFeedback(w.sup, f.id, "Answering for the guard")).rejects.toThrow(/not found/i);
    await expect(replyToFeedback(w.me1, f.id, "")).rejects.toThrow();
    const r = await replyToFeedback(w.me1, f.id, "I had no pen; I have one now");
    expect(r.employeeReply).toBe("I had no pen; I have one now");
    await expect(replyToFeedback(w.me1, f.id, "Changing my reply later")).rejects.toThrow(/already/i);
    expect((await myFeedback(w.me1))[0].reply).toBe("I had no pen; I have one now");
    expect((await listFeedback(w.sup, {}))[0].employeeReply).toBe("I had no pen; I have one now"); // the manager and HR see the reply
  });
});

describe("correcting a mistake: HR voids, nothing is edited or deleted", () => {
  it("a voided entry needs a reason, stays on record, and disappears from the employee's page and the default lists", async () => {
    const w = await world();
    const f = await w.praise(w.sup, w.g1.id);
    await expect(voidFeedback(w.sup, f.id, "Entered about the wrong guard")).rejects.toThrow(/permission/); // a manager cannot void
    await expect(voidFeedback(w.hr, f.id, "")).rejects.toThrow();
    const v = await voidFeedback(w.hr, f.id, "Entered about the wrong guard");
    expect(v).toMatchObject({ voidedByUserId: w.hr.userId, voidReason: "Entered about the wrong guard" });
    expect(v.voidedAt).toBeInstanceOf(Date);
    expect(await myFeedback(w.me1)).toEqual([]);
    expect(await listFeedback(w.hr, {})).toEqual([]);
    expect((await listFeedback(w.hr, { includeVoided: true })).map((x) => x.id)).toEqual([f.id]); // kept
    await expect(replyToFeedback(w.me1, f.id, "Replying to a voided entry")).rejects.toThrow(/not found/i);
    await expect(voidFeedback(w.hr, f.id, "Voiding it a second time")).rejects.toThrow(/already/i);
    expect(await db.performanceFeedback.count({ where: { organizationId: w.t.org.id } })).toBe(1); // never deleted
  });
  it("another company cannot void it", async () => {
    const w = await world();
    const f = await w.praise(w.sup, w.g1.id);
    const o = await world();
    await expect(voidFeedback(o.hr, f.id, "Another company's entry")).rejects.toThrow(/not found/i);
  });
});

describe("evidence on an appraisal: read-only, never a score", () => {
  async function appraisalFor(w: Awaited<ReturnType<typeof world>>, employeeId: string) {
    const cycle = await db.appraisalCycle.create({ data: { organizationId: w.t.org.id, name: `Cycle ${uid()}`, periodStart: new Date(day(-30)), periodEnd: new Date(day(30)), dueDate: new Date(day(40)), createdBy: "test" } });
    return db.appraisal.create({ data: { organizationId: w.t.org.id, cycleId: cycle.id, employeeId, status: "DRAFT" } });
  }
  it("the reviewer and HR see the entries dated inside the cycle's period for that employee, and nothing else", async () => {
    const w = await world();
    const inside = await w.praise(w.sup, w.g1.id, { relatesOn: day(-5) });
    await w.praise(w.sup, w.g1.id, { relatesOn: day(-60) }); // before the period
    await w.praise(w.sup, w.g2.id, { relatesOn: day(-5) }); // another employee
    const voided = await w.praise(w.sup, w.g1.id, { relatesOn: day(-4) });
    await voidFeedback(w.hr, voided.id, "Entered by mistake");
    const a = await appraisalFor(w, w.g1.id);
    expect((await feedbackForAppraisal(w.sup, a.id)).map((x) => x.id)).toEqual([inside.id]);
    expect((await feedbackForAppraisal(w.hr, a.id)).map((x) => x.id)).toEqual([inside.id]);
  });
  it("shows nothing to the employee, a manager who does not manage them, or another company, and changes nothing on the appraisal", async () => {
    const w = await world();
    await w.praise(w.sup, w.g1.id, { relatesOn: day(-5) });
    const a = await appraisalFor(w, w.g1.id);
    const before = await db.appraisal.findUniqueOrThrow({ where: { id: a.id } });
    expect(await feedbackForAppraisal(w.me1, a.id)).toEqual([]);
    expect(await feedbackForAppraisal(w.sup2, a.id)).toEqual([]);
    expect(await feedbackForAppraisal(await login(w.t, "AUDITOR"), a.id)).toEqual([]);
    expect(await feedbackForAppraisal((await world()).hr, a.id)).toEqual([]);
    expect(await db.appraisal.findUniqueOrThrow({ where: { id: a.id } })).toEqual(before); // no score, rating or recommendation moved
  });
});

describe("the audit trail", () => {
  it("records every step by ids, and never what the note, the reply or the reason says", async () => {
    const w = await world();
    const f = await giveFeedback(w.sup, { employeeId: w.g1.id, kind: "COACHING", body: "SECRET-NOTE use the template on the radio card" });
    await replyToFeedback(w.me1, f.id, "SECRET-REPLY I have a pen now");
    await voidFeedback(w.hr, f.id, "SECRET-REASON wrong guard");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "FEEDBACK_" } }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["FEEDBACK_GIVE", "FEEDBACK_REPLY", "FEEDBACK_VOID"]);
    const text = JSON.stringify(rows);
    for (const s of ["SECRET-NOTE", "SECRET-REPLY", "SECRET-REASON"]) expect(text, s).not.toContain(s);
    expect(rows[0]).toMatchObject({ entity: "PerformanceFeedback", entityId: f.id, userId: w.sup.userId });
    expect(rows[0].newValue).toMatchObject({ employeeId: w.g1.id, kind: "COACHING" });
  });
});

describe("personal data: the employee's copy and erasure", () => {
  it("a person's feedback is in the copy of their data they can ask for (not a voided entry, not anyone else's)", async () => {
    const w = await world();
    const f = await w.praise(w.sup, w.g1.id);
    await replyToFeedback(w.me1, f.id, "SECRET-REPLY thank you");
    const gone = await w.praise(w.sup, w.g1.id, { body: "SECRET-VOIDED entered by mistake" });
    await voidFeedback(w.hr, gone.id, "Entered by mistake");
    await w.praise(w.sup, w.g2.id, { body: "SECRET-OTHER about someone else" });
    const text = JSON.stringify((await compileEmployeeData(w.t.org.id, w.g1.id)).sections.feedback.records);
    expect(text).toContain("SECRET-PRAISE");
    expect(text).toContain("SECRET-REPLY");
    expect(text).not.toContain("SECRET-VOIDED");
    expect(text).not.toContain("SECRET-OTHER");
  });
  it("erasing an employee removes the words in every entry, reply and void reason, keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const f = await w.praise(w.sup, w.g1.id);
    await replyToFeedback(w.me1, f.id, "SECRET-REPLY thank you");
    const v = await w.praise(w.sup, w.g1.id, { body: "SECRET-VOIDED entered by mistake" });
    await voidFeedback(w.hr, v.id, "SECRET-REASON entered by mistake");
    const other = await w.praise(w.sup, w.g2.id, { body: "OTHER-STAYS written about someone else" });
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g1.id, new Date()));
    expect(counts.feedback).toBe(2);
    const rows = await db.performanceFeedback.findMany({ where: { employeeId: w.g1.id } });
    const text = JSON.stringify(rows);
    for (const s of ["SECRET-PRAISE", "SECRET-REPLY", "SECRET-VOIDED", "SECRET-REASON"]) expect(text, s).not.toContain(s);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === f.id)).toMatchObject({ kind: "RECOGNITION" }); // the shape stays
    expect((await db.performanceFeedback.findUniqueOrThrow({ where: { id: other.id } })).body).toContain("OTHER-STAYS");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});
