import { afterEach, describe, expect, it } from "vitest";
import { createEmployee } from "@/server/services/employees";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import {
  addCaseNote,
  assignCase,
  caseStats,
  closeCase,
  getCase,
  issueSanctionFromCase,
  listCases,
  raiseCase,
  reopenCase,
  resolveCase,
  setCaseStatus,
} from "@/server/services/relations";
import { approveDisciplinary, listSanctions, raiseDisciplinary, rejectDisciplinary } from "@/server/services/hr";
import { employeeTimeline, hrOverview } from "@/server/services/hr-overview";
import { todayUtc } from "@/server/services/hr-policy";
import { previewHrDigest } from "@/server/services/reminders";
import { isolatedOrg } from "../helpers";

// Misconduct cases and sanctions were split from employee relations on 2026-11-05 (the founder's decision):
// they need the existing HR permission AND a disciplinary one, so access can only get tighter.

const restore: Array<() => void> = [];
/** Takes one permission away from one role for the rest of the test (the roles are fixed in code). */
function without(role: Role, permission: string) {
  const was = ROLE_PERMISSIONS[role];
  ROLE_PERMISSIONS[role] = was.filter((p) => p !== (permission as Permission));
  restore.push(() => {
    ROLE_PERMISSIONS[role] = was;
  });
}
afterEach(() => {
  while (restore.length) restore.pop()!();
});

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Split", lastName: "Case", employmentDate: "2024-01-01", categoryId: t.guardId });
  const misconduct = await raiseCase(hr, { employeeId: emp.id, type: "MISCONDUCT", summary: "Left the post early", description: "Left the gate unmanned for two hours." });
  const counselling = await raiseCase(hr, { employeeId: emp.id, type: "COUNSELLING", summary: "Lateness chat", description: "Discussed repeated lateness with the employee." });
  return { t, hr, boss, emp, misconduct, counselling };
}

describe("two lists: employee relations, and disciplinary", () => {
  it("each page lists only its own kind of case", async () => {
    const { hr, misconduct, counselling } = await world();
    const rel = (await listCases(hr, { scope: "relations" })).map((c) => c.id);
    const dis = (await listCases(hr, { scope: "discipline" })).map((c) => c.id);
    expect(rel).toContain(counselling.id);
    expect(rel).not.toContain(misconduct.id);
    expect(dis).toEqual([misconduct.id]);
    expect((await listCases(hr)).map((c) => c.id).sort()).toEqual([counselling.id, misconduct.id].sort());
  });

  it("the headline numbers are counted per page", async () => {
    const { hr } = await world();
    expect((await caseStats(hr, "relations")).open).toBe(1);
    expect((await caseStats(hr, "discipline")).open).toBe(1);
    expect((await caseStats(hr)).open).toBe(2);
  });
});

describe("someone with HR access but no disciplinary access", () => {
  it("does not see misconduct cases in any list, and cannot open one by its id", async () => {
    const { t, misconduct, counselling } = await world();
    const fin = t.ctx("FINANCE"); // reads HR records today (read-only), but is not part of discipline
    expect((await listCases(fin)).map((c) => c.id)).toEqual([counselling.id]);
    await expect(listCases(fin, { scope: "discipline" })).rejects.toThrow(/permission/);
    await expect(getCase(fin, misconduct.id)).rejects.toThrow(/not found/i); // does not even confirm the case exists
    await expect(getCase(fin, counselling.id)).resolves.toBeTruthy();
  });

  it("is not counted in the headline numbers either", async () => {
    const { t } = await world();
    expect((await caseStats(t.ctx("FINANCE"))).open).toBe(1);
  });

  it("an auditor still reads both kinds, because audit needs the whole file", async () => {
    const { t, misconduct, counselling } = await world();
    const aud = t.ctx("AUDITOR");
    expect((await listCases(aud)).map((c) => c.id).sort()).toEqual([counselling.id, misconduct.id].sort());
    await expect(getCase(aud, misconduct.id)).resolves.toBeTruthy();
    await expect(addCaseNote(aud, misconduct.id, { kind: "NOTE", note: "An auditor may not write" })).rejects.toThrow(/permission/);
  });
});

describe("an HR administrator without the disciplinary permission", () => {
  it("handles grievances and counselling as before, but cannot open or work a misconduct case", async () => {
    const { t, hr, emp, misconduct, counselling } = await world();
    without("HR_ADMIN", "discipline.manage");
    without("HR_ADMIN", "discipline.view");
    const hr2 = t.ctx("HR_ADMIN");
    await expect(raiseCase(hr2, { employeeId: emp.id, type: "MISCONDUCT", summary: "Another matter", description: "Failed to follow an instruction." })).rejects.toThrow(/permission/);
    await expect(addCaseNote(hr2, misconduct.id, { kind: "NOTE", note: "Not mine to touch" })).rejects.toThrow();
    await expect(setCaseStatus(hr2, misconduct.id, "INVESTIGATING")).rejects.toThrow();
    await expect(assignCase(hr2, misconduct.id, "Someone")).rejects.toThrow();
    await expect(resolveCase(hr2, misconduct.id, { outcome: "SUBSTANTIATED", resolution: "Not permitted for this person." })).rejects.toThrow();
    await expect(getCase(hr2, misconduct.id)).rejects.toThrow(/not found/i);
    // the grievance side is untouched
    await expect(raiseCase(hr2, { employeeId: emp.id, type: "GRIEVANCE", summary: "Shift swap refused", description: "The employee says a swap was refused unfairly." })).resolves.toBeTruthy();
    await expect(addCaseNote(hr2, counselling.id, { kind: "NOTE", note: "Follow-up held" })).resolves.toBeTruthy();
    await expect(setCaseStatus(hr2, counselling.id, "INVESTIGATING")).resolves.toBeTruthy();
    expect(hr).toBeTruthy();
  });

  it("can read but not work a misconduct case when only the manage permission is taken away", async () => {
    const { t, misconduct } = await world();
    without("HR_ADMIN", "discipline.manage");
    const hr2 = t.ctx("HR_ADMIN");
    await expect(getCase(hr2, misconduct.id)).resolves.toBeTruthy();
    await expect(addCaseNote(hr2, misconduct.id, { kind: "NOTE", note: "Read-only now" })).rejects.toThrow(/permission/);
  });

  it("the company administrator needs the disciplinary permission as well as hr.approve to close or re-open a misconduct case", async () => {
    const { t, hr, boss, misconduct } = await world();
    await resolveCase(hr, misconduct.id, { outcome: "UNSUBSTANTIATED", resolution: "CCTV shows the post was covered throughout." });
    without("COMPANY_ADMIN", "discipline.manage");
    const boss2 = t.ctx("COMPANY_ADMIN");
    await expect(closeCase(boss2, misconduct.id)).rejects.toThrow(/permission/);
    restore.pop()!();
    await closeCase(boss, misconduct.id);
    without("COMPANY_ADMIN", "discipline.manage");
    await expect(reopenCase(boss2, misconduct.id, "Employee lodged an appeal")).rejects.toThrow(/permission/);
  });

  it("cannot issue a sanction from a misconduct case", async () => {
    const { t, hr, misconduct } = await world();
    await resolveCase(hr, misconduct.id, { outcome: "SUBSTANTIATED", resolution: "CCTV confirms the post was left." });
    without("HR_ADMIN", "discipline.manage");
    await expect(issueSanctionFromCase(t.ctx("HR_ADMIN"), misconduct.id, { type: "WRITTEN_WARNING", actionTaken: "Written warning" })).rejects.toThrow(/permission/);
  });
});

describe("sanctions in the disciplinary register", () => {
  it("raising, approving and rejecting a sanction needs the disciplinary permission; a commendation does not", async () => {
    const { t, hr, boss, emp } = await world();
    const when = iso(todayUtc());
    const warn = await raiseDisciplinary(hr, { employeeId: emp.id, type: "VERBAL_WARNING", incidentDate: when, description: "Late three times in a week" });
    const reject = await raiseDisciplinary(hr, { employeeId: emp.id, type: "QUERY", incidentDate: when, description: "Missing report" });
    without("HR_ADMIN", "discipline.manage");
    without("COMPANY_ADMIN", "discipline.manage");
    const hr2 = t.ctx("HR_ADMIN");
    const boss2 = t.ctx("COMPANY_ADMIN");
    await expect(raiseDisciplinary(hr2, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: when, description: "Repeat lateness" })).rejects.toThrow(/permission/);
    await expect(approveDisciplinary(boss2, warn.id)).rejects.toThrow(/permission/);
    await expect(rejectDisciplinary(boss2, reject.id, "Not enough evidence")).rejects.toThrow(/permission/);
    // praise is not discipline: it stays with plain HR access
    await expect(raiseDisciplinary(hr2, { employeeId: emp.id, type: "COMMENDATION", incidentDate: when, description: "Foiled a break-in" })).resolves.toBeTruthy();
    // and with the permission it all works as before (maker and checker)
    restore.splice(0).reverse().forEach((f) => f());
    await expect(approveDisciplinary(boss, warn.id)).resolves.toBeTruthy();
    await expect(rejectDisciplinary(boss, reject.id, "Not enough evidence")).resolves.toBeTruthy();
  });
});

describe("where else a misconduct case or sanction could show", () => {
  it("the employee's timeline hides approved sanctions and misconduct cases from someone without disciplinary access, but shows commendations", async () => {
    const { t, hr, boss, emp } = await world();
    const when = iso(todayUtc());
    const w = await raiseDisciplinary(hr, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: when, description: "Left post" });
    await approveDisciplinary(boss, w.id);
    const c = await raiseDisciplinary(hr, { employeeId: emp.id, type: "COMMENDATION", incidentDate: when, description: "Caught a thief" });
    await approveDisciplinary(boss, c.id);
    const kinds = async (role: Role) => (await employeeTimeline(t.ctx(role), emp.id)).map((e) => e.kind);
    expect(await kinds("FINANCE")).toContain("Commendation");
    expect(await kinds("FINANCE")).not.toContain("Disciplinary");
    expect(await kinds("FINANCE")).not.toContain("Relations");
    expect(await kinds("HR_ADMIN")).toEqual(expect.arrayContaining(["Commendation", "Disciplinary", "Relations"]));
    expect(await kinds("AUDITOR")).toContain("Disciplinary");
  });

  it("the HR overview counts employee relations without misconduct, and shows the disciplinary numbers only to those who may see them", async () => {
    const { t, hr } = await world();
    const o = await hrOverview(hr);
    expect(o.relations.open).toBe(1);
    expect(o.discipline?.open).toBe(1);
    expect((await hrOverview(t.ctx("FINANCE"))).discipline).toBeNull();
    expect((await hrOverview(t.ctx("FINANCE"))).relations.open).toBe(1);
  });

  it("the digest preview leaves misconduct deadlines and pending sanctions out for someone without disciplinary access", async () => {
    const { t, hr, emp, misconduct } = await world();
    await raiseDisciplinary(hr, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: iso(todayUtc()), description: "Pending sign-off" });
    await db.relationsCase.update({ where: { id: misconduct.id }, data: { dueDate: addDays(todayUtc(), 1) } }); // the digest lists cases due within 3 days
    const text = (d: Awaited<ReturnType<typeof previewHrDigest>>) => JSON.stringify(d.digest.sections);
    const asHr = text(await previewHrDigest(hr));
    const asFin = text(await previewHrDigest(t.ctx("FINANCE")));
    expect(asHr).toContain(misconduct.caseNumber);
    expect(asHr).toMatch(/Disciplinary record/);
    expect(asFin).not.toContain(misconduct.caseNumber);
    expect(asFin).not.toMatch(/Disciplinary record/);
  });

  it("the sanctions list shows sanctions waiting for sign-off, never commendations, and only to those with disciplinary access", async () => {
    const { t, hr, boss, emp } = await world();
    const when = iso(todayUtc());
    const w = await raiseDisciplinary(hr, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: when, description: "Left post" });
    await raiseDisciplinary(hr, { employeeId: emp.id, type: "COMMENDATION", incidentDate: when, description: "Caught a thief" });
    expect((await listSanctions(hr, { status: "PENDING" })).map((r) => r.id)).toEqual([w.id]);
    await approveDisciplinary(boss, w.id);
    expect(await listSanctions(hr, { status: "PENDING" })).toEqual([]);
    expect((await listSanctions(t.ctx("AUDITOR"), { status: "APPROVED" })).map((r) => r.id)).toEqual([w.id]);
    await expect(listSanctions(t.ctx("FINANCE"))).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    expect(await listSanctions(other.ctx("HR_ADMIN"))).toEqual([]); // another company never sees it
  });

  it("another company's misconduct case is not found", async () => {
    const { misconduct } = await world();
    const other = await isolatedOrg();
    await expect(getCase(other.ctx("HR_ADMIN"), misconduct.id)).rejects.toThrow(/not found/i);
  });
});
