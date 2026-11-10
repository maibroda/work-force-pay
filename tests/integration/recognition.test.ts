import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import {
  addAwardType,
  approveAward,
  listAwards,
  listAwardTypes,
  milestones,
  myRecognition,
  nominate,
  recognitionBoard,
  rejectAward,
  setAnnounceAgreement,
  setAwardTypeActive,
  withdrawAward,
} from "@/server/services/recognition";
import { isolatedOrg, uid } from "../helpers";

// Welfare and recognition, step 1: recognition awards (the founder's go of 2026-11-10; plan docs/plans/welfare-recognition-plan.md).
// Recommended answers: a manager (direct reports) or HR nominates, a second person approves, the employee sees it, announcing is off unless the type allows it and
// the recipient agrees, milestones are only a prompt, and no money is involved.

const today = () => iso(todayUtc());
const CITATION = "SECRET-CITATION reported a damaged fire exit and stayed until it was secured";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@rec.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN"); // nominates (anyone) and may configure
  const boss = await login(t, "COMPANY_ADMIN"); // approves
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const sup2Emp = await createEmployee(hr, { firstName: "Tunde", lastName: "Other", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup2 = await login(t, "SUPERVISOR", sup2Emp.id);
  const g1 = await createEmployee(hr, { firstName: "Gbenga", lastName: "One", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id });
  const g2 = await createEmployee(hr, { firstName: "Hauwa", lastName: "Two", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id });
  const g3 = await createEmployee(hr, { firstName: "Ife", lastName: "Three", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  const me1 = await login(t, "EMPLOYEE", g1.id);
  const me2 = await login(t, "EMPLOYEE", g2.id);
  const safety = await addAwardType(hr, { name: "Safety star", description: "For a safety catch", mayAnnounce: true });
  const quiet = await addAwardType(hr, { name: "Employee of the month" }); // may not be announced
  const nom = (ctx: Ctx, employeeId: string, typeId = safety.id, citation = CITATION) => nominate(ctx, { employeeId, typeId, citation });
  return { t, hr, boss, supEmp, sup, sup2, g1, g2, g3, me1, me2, safety, quiet, nom };
}
type W = Awaited<ReturnType<typeof world>>;
/** A nomination by the supervisor, approved by the company administrator. */
async function approved(w: W, employeeId = w.g1.id, typeId = w.safety.id) {
  const n = await w.nom(w.sup, employeeId, typeId);
  return approveAward(w.boss, n.id);
}

describe("award types", () => {
  it("are the company's own: a name, a description, whether it may be announced and an optional long-service year; none are provided", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    expect(await listAwardTypes(hr)).toEqual([]);
    const s = await addAwardType(hr, { name: "5 years' service", longServiceYears: 5 });
    expect(s).toMatchObject({ name: "5 years' service", longServiceYears: 5, mayAnnounce: false, active: true });
    await expect(addAwardType(hr, { name: "  5 YEARS' service " })).rejects.toThrow(/already/i); // however it is typed
    await expect(addAwardType(hr, { name: "Ab" })).rejects.toThrow();
    await expect(addAwardType(hr, { name: "Too long service", longServiceYears: 61 })).rejects.toThrow();
  });
  it("can be switched off, taking no new nomination, and are configured only by someone who configures HR", async () => {
    const w = await world();
    await setAwardTypeActive(w.hr, w.safety.id, false);
    await expect(w.nom(w.sup, w.g1.id, w.safety.id)).rejects.toThrow(/switched off|not active/i);
    await expect(addAwardType(await login(w.t, "AUDITOR"), { name: "Not allowed" })).rejects.toThrow(/permission/);
    await expect(addAwardType(w.sup, { name: "Not allowed" })).rejects.toThrow(/permission/);
    await expect(setAwardTypeActive((await world()).hr, w.safety.id, true)).rejects.toThrow(/not found/i); // another company's
    expect((await listAwardTypes((await world()).hr)).map((x) => x.id)).not.toContain(w.safety.id);
  });
  it("are listed for HR and for a manager who nominates, not for an employee", async () => {
    const w = await world();
    expect((await listAwardTypes(w.sup)).map((x) => x.name).sort()).toEqual(["Employee of the month", "Safety star"]);
    await expect(listAwardTypes(w.me1)).rejects.toThrow(/permission/);
  });
});

describe("nominating", () => {
  it("a manager nominates a direct report, and HR anyone, with a citation", async () => {
    const w = await world();
    const a = await w.nom(w.sup, w.g1.id);
    expect(a).toMatchObject({ status: "NOMINATED", employeeId: w.g1.id, typeId: w.safety.id, nominatedByUserId: w.sup.userId });
    await expect(w.nom(w.hr, w.g3.id)).resolves.toMatchObject({ status: "NOMINATED", employeeId: w.g3.id });
  });
  it("a manager cannot nominate someone who does not report to them (only 'not found'), and nobody nominates themselves", async () => {
    const w = await world();
    await expect(w.nom(w.sup, w.g3.id)).rejects.toThrow(/employee not found/i);
    await expect(w.nom(w.sup, w.supEmp.id)).rejects.toThrow(/yourself/i);
    const hrEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Hr", employmentDate: "2020-01-01", categoryId: w.t.officeId });
    await expect(w.nom(await login(w.t, "HR_ADMIN", hrEmp.id), hrEmp.id)).rejects.toThrow(/yourself/i);
    const other = await world();
    await expect(w.nom(w.hr, other.g1.id)).rejects.toThrow(/employee not found/i);
  });
  it("needs a real citation, an active type of this company, an employee who is still active, and no second open nomination for the same award", async () => {
    const w = await world();
    await expect(w.nom(w.sup, w.g1.id, w.safety.id, "Good")).rejects.toThrow();
    await expect(w.nom(w.sup, w.g1.id, "does-not-exist")).rejects.toThrow(/award type not found/i);
    await db.employee.update({ where: { id: w.g2.id }, data: { status: "RESIGNED" } });
    await expect(w.nom(w.sup, w.g2.id)).rejects.toThrow(/no longer active/i);
    await w.nom(w.sup, w.g1.id);
    await expect(w.nom(w.sup, w.g1.id)).rejects.toThrow(/already nominated/i);
    await expect(w.nom(w.sup, w.g1.id, w.quiet.id)).resolves.toBeTruthy(); // a different award is fine
  });
  it("is for managers and HR: the employee, finance and the auditor are refused", async () => {
    const w = await world();
    for (const ctx of [w.me1, await login(w.t, "FINANCE"), await login(w.t, "AUDITOR")]) await expect(w.nom(ctx, w.g1.id), ctx.role).rejects.toThrow(/permission/);
  });
});

describe("deciding: a second person approves", () => {
  it("the person who nominated an award cannot approve or reject it; someone else with the approve right can", async () => {
    const w = await world();
    const n = await w.nom(w.hr, w.g1.id); // HR holds the approve right but nominated this one
    await expect(approveAward(w.hr, n.id)).rejects.toThrow(/nominated this person/i);
    await expect(rejectAward(w.hr, n.id, "Rejecting my own nomination")).rejects.toThrow(/nominated this person/i);
    const a = await approveAward(w.boss, n.id);
    expect(a).toMatchObject({ status: "APPROVED", decidedByUserId: w.boss.userId });
    expect(iso(a.awardedOn)).toBe(today());
  });
  it("a manager, finance and the auditor cannot decide at all", async () => {
    const w = await world();
    const n = await w.nom(w.sup, w.g1.id);
    for (const ctx of [w.sup, await login(w.t, "FINANCE"), await login(w.t, "AUDITOR"), w.me1]) await expect(approveAward(ctx, n.id), ctx.role).rejects.toThrow(/permission/);
  });
  it("a rejection needs a reason and stays on record; a decided award is not decided again", async () => {
    const w = await world();
    const n = await w.nom(w.sup, w.g1.id);
    await expect(rejectAward(w.boss, n.id, "")).rejects.toThrow(/reason/i);
    expect(await rejectAward(w.boss, n.id, "Not enough to justify an award")).toMatchObject({ status: "REJECTED", decisionNote: "Not enough to justify an award" });
    await expect(approveAward(w.boss, n.id)).rejects.toThrow(/already|nominated/i);
    expect(await db.recognitionAward.count({ where: { organizationId: w.t.org.id } })).toBe(1); // kept
  });
  it("the nominator withdraws their own nomination with a reason; after approval only the approve right can withdraw (a correction)", async () => {
    const w = await world();
    const a = await w.nom(w.sup, w.g1.id);
    await expect(withdrawAward(w.sup2, a.id, "Withdrawing someone else's")).rejects.toThrow();
    await expect(withdrawAward(w.sup, a.id, "")).rejects.toThrow(/reason/i);
    expect(await withdrawAward(w.sup, a.id, "Nominated the wrong guard")).toMatchObject({ status: "WITHDRAWN" });
    const b = await approved(w, w.g2.id);
    await expect(withdrawAward(w.sup, b.id, "Changing my mind after approval")).rejects.toThrow(/permission|approve/i);
    expect(await withdrawAward(w.boss, b.id, "Approved in error: wrong guard")).toMatchObject({ status: "WITHDRAWN" });
    await expect(withdrawAward(w.boss, b.id, "Withdrawing it twice")).rejects.toThrow(/already|withdrawn/i);
  });
  it("another company cannot see or decide it", async () => {
    const w = await world();
    const n = await w.nom(w.sup, w.g1.id);
    const o = await world();
    await expect(approveAward(o.boss, n.id)).rejects.toThrow(/not found/i);
    expect(await listAwards(o.hr, {})).toEqual([]);
  });
});

describe("reading the nominations", () => {
  it("HR reads every nomination with its status; a manager reads only the ones they made", async () => {
    const w = await world();
    const a = await w.nom(w.sup, w.g1.id);
    const b = await w.nom(w.sup2, w.g3.id);
    expect((await listAwards(w.hr, {})).map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await listAwards(w.sup, {})).map((x) => x.id)).toEqual([a.id]);
    expect((await listAwards(w.hr, { status: "APPROVED" }))).toEqual([]);
    await expect(listAwards(w.me1, {})).rejects.toThrow(/permission/);
  });
});

describe("the employee's own recognition", () => {
  it("shows only their approved awards with the citation: not a nomination still being considered, nor a rejected or withdrawn one, nor anyone else's", async () => {
    const w = await world();
    const ok = await approved(w, w.g1.id);
    await w.nom(w.sup, w.g1.id, w.quiet.id); // still a nomination
    const rej = await w.nom(w.sup, w.g1.id, w.quiet.id).catch(() => null);
    expect(rej).toBeNull(); // (a second open nomination of the same award is refused)
    await approved(w, w.g2.id);
    const mine = await myRecognition(w.me1);
    expect(mine.map((x) => x.id)).toEqual([ok.id]);
    expect(mine[0]).toMatchObject({ awardName: "Safety star", mayAnnounce: true, announceAgreed: null });
    expect(mine[0].citation).toContain("SECRET-CITATION");
    expect(await myRecognition(await login(w.t, "FINANCE"))).toEqual([]); // no employee record
  });
});

describe("announcing: off unless the type allows it and the recipient agrees", () => {
  it("the recognition board shows only an approved award of an announceable type that the recipient agreed to, for someone still here", async () => {
    const w = await world();
    const a = await approved(w, w.g1.id, w.safety.id);
    const q = await approved(w, w.g2.id, w.quiet.id);
    expect(await recognitionBoard(w.me2)).toEqual([]); // nobody has agreed
    await setAnnounceAgreement(w.me1, a.id, true);
    const board = await recognitionBoard(w.me2); // any employee reads it
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ awardName: "Safety star", employeeName: expect.stringContaining("Gbenga") });
    expect(board[0].citation).toContain("SECRET-CITATION");
    await expect(setAnnounceAgreement(w.me2, q.id, true)).rejects.toThrow(/not announced|may not be announced/i); // the type is never announced
    await setAnnounceAgreement(w.me1, a.id, false); // they can change their mind
    expect(await recognitionBoard(w.me2)).toEqual([]);
  });
  it("only the recipient answers, only for their own approved award; a leaver and another company never appear", async () => {
    const w = await world();
    const a = await approved(w, w.g1.id, w.safety.id);
    await expect(setAnnounceAgreement(w.me2, a.id, true)).rejects.toThrow(/not found/i);
    await expect(setAnnounceAgreement(w.hr, a.id, true)).rejects.toThrow(/not found/i);
    await setAnnounceAgreement(w.me1, a.id, true);
    await db.employee.update({ where: { id: w.g1.id }, data: { status: "RESIGNED" } });
    expect(await recognitionBoard(w.me2)).toEqual([]);
    await db.employee.update({ where: { id: w.g1.id }, data: { status: "ACTIVE" } });
    expect((await recognitionBoard((await world()).me1))).toEqual([]);
    const pending = await w.nom(w.sup, w.g2.id, w.safety.id);
    await expect(setAnnounceAgreement(w.me2, pending.id, true)).rejects.toThrow(/not found/i); // not approved yet
  });
});

describe("long-service milestones: a prompt, never an award", () => {
  async function anniversaryIn(w: W, years: number, inDays: number, name: string) {
    const d = addDays(todayUtc(), inDays);
    return createEmployee(w.hr, { firstName: name, lastName: "Service", employmentDate: iso(new Date(Date.UTC(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate()))), categoryId: w.t.guardId });
  }
  it("starts at 5, 10, 15 and 20 years, lists who reaches one in the next 60 days, and creates no award", async () => {
    const w = await world();
    expect((await getHrPolicy(w.t.org.id)).longServiceYears).toEqual([5, 10, 15, 20]);
    const five = await anniversaryIn(w, 5, 12, "Five");
    const ten = await anniversaryIn(w, 10, 50, "Ten");
    await anniversaryIn(w, 4, 12, "Four"); // not a milestone
    await anniversaryIn(w, 5, 90, "Later"); // outside the window
    const rows = await milestones(w.hr, {});
    expect(rows.map((r) => [r.employee.id, r.years])).toEqual([[five.id, 5], [ten.id, 10]]);
    expect(rows[0]).toMatchObject({ hasAward: false });
    expect(await db.recognitionAward.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
  it("follows the company's own years, and shows whether a long-service award has been nominated", async () => {
    const w = await world();
    const nine = await anniversaryIn(w, 9, 12, "Nine");
    await updateHrPolicy(w.hr, { longServiceYears: [9] });
    expect((await milestones(w.hr, {})).map((r) => r.employee.id)).toEqual([nine.id]);
    const service = await addAwardType(w.hr, { name: "9 years' service", longServiceYears: 9 });
    await nominate(w.hr, { employeeId: nine.id, typeId: service.id, citation: "Nine loyal years of service to the company" });
    expect((await milestones(w.hr, {}))[0]).toMatchObject({ hasAward: true });
    await expect(updateHrPolicy(w.hr, { longServiceYears: [61] })).rejects.toThrow();
    await expect(updateHrPolicy(w.hr, { longServiceYears: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })).rejects.toThrow();
  });
  it("is for those who read HR records, and another company's people are its own", async () => {
    const w = await world();
    await anniversaryIn(w, 5, 12, "Five");
    await expect(milestones(w.me1, {})).rejects.toThrow(/permission/);
    expect(await milestones((await world()).hr, {})).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("records every step by ids, never a citation or a reason", async () => {
    const w = await world();
    const a = await w.nom(w.sup, w.g1.id);
    await approveAward(w.boss, a.id);
    await setAnnounceAgreement(w.me1, a.id, true);
    const b = await w.nom(w.sup, w.g2.id, w.quiet.id, "SECRET-OTHER-CITATION a quiet word about steady work");
    await rejectAward(w.boss, b.id, "SECRET-REASON not enough to justify it");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "RECOGNITION_" } } });
    const actions = new Set(rows.map((r) => r.action));
    for (const x of ["RECOGNITION_TYPE_ADD", "RECOGNITION_NOMINATE", "RECOGNITION_APPROVE", "RECOGNITION_REJECT", "RECOGNITION_ANNOUNCE"]) expect(actions.has(x), x).toBe(true);
    const text = JSON.stringify(rows);
    for (const s of ["SECRET-CITATION", "SECRET-OTHER-CITATION", "SECRET-REASON"]) expect(text, s).not.toContain(s);
    expect(rows.find((r) => r.action === "RECOGNITION_APPROVE")).toMatchObject({ entity: "RecognitionAward", entityId: a.id, userId: w.boss.userId });
  });
});

describe("personal data: the employee's copy and erasure", () => {
  it("their approved awards and citations are in the copy of their data, never one still being considered, and no one else's", async () => {
    const w = await world();
    await approved(w, w.g1.id);
    await w.nom(w.sup, w.g1.id, w.quiet.id, "SECRET-PENDING a nomination they have not been told about");
    await approved(w, w.g2.id).then(() => null);
    const text = JSON.stringify((await compileEmployeeData(w.t.org.id, w.g1.id)).sections.recognition.records);
    expect(text).toContain("SECRET-CITATION");
    expect(text).toContain("Safety star");
    expect(text).not.toContain("SECRET-PENDING");
    expect((await compileEmployeeData(w.t.org.id, w.g3.id)).sections.recognition.records).toEqual([]);
  });
  it("erasing an employee removes the words (the citation and any decision note), keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const a = await approved(w, w.g1.id);
    const b = await approved(w, w.g2.id);
    const rej = await w.nom(w.sup, w.g1.id, w.quiet.id, "SECRET-REJECTED-CITATION about steady work all year");
    await rejectAward(w.boss, rej.id, "SECRET-REASON not enough");
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g1.id, new Date()));
    expect(counts.recognitionAwards).toBe(2);
    const rows = await db.recognitionAward.findMany({ where: { employeeId: w.g1.id } });
    const text = JSON.stringify(rows);
    for (const s of ["SECRET-CITATION", "SECRET-REJECTED-CITATION", "SECRET-REASON"]) expect(text, s).not.toContain(s);
    expect(rows.find((r) => r.id === a.id)).toMatchObject({ status: "APPROVED" }); // the shape stays
    expect((await db.recognitionAward.findUniqueOrThrow({ where: { id: b.id } })).citation).toContain("SECRET-CITATION"); // someone else's is untouched
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});
