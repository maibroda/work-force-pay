import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { raiseCase, getCase, listCases, addCaseNote, assignCase, resolveCase, closeCase, setCaseStatus } from "@/server/services/relations";
import { welfareSummary } from "@/server/services/welfare";
import { addSuccessionRole, successionOverview } from "@/server/services/succession";
import { createSurvey, listSurveys } from "@/server/services/survey";
import { appointOfficer, grantFunction, listOfficers, loadGrantPermissions, removeOfficer, revokeFunction, unheldFunctionsFor } from "@/server/services/hr-officers";
import bcrypt from "bcryptjs";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { authenticate } from "@/server/services/users";
import { isolatedOrg, uid } from "../helpers";

// HR governance, step 1: the Delegated HR Officer (the founder's go; plan docs/plans/hr-governance-step1-plan.md). Nothing in HR until the Company Administrator
// grants one or more of four fixed functions; a grant opens only its own function; the administrator who appoints gains nothing; revoking is immediate.

const today = () => iso(todayUtc());
const SECRET = "SECRET-WELFARE-TEXT a death in the family";

async function user(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null, extra: Record<string, unknown> = {}) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@gov.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId, ...extra } });
}
/** A request context built the way the real one is: the role, plus the live grants read from the database at that moment. */
async function ctxOf(u: { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null }): Promise<Ctx> {
  const grants = u.role === "HR_OFFICER" ? await loadGrantPermissions(u.id) : undefined;
  return { userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId, grants };
}

async function world() {
  const t = await isolatedOrg();
  const boss = await ctxOf(await user(t, "COMPANY_ADMIN"));
  const auditor = await ctxOf(await user(t, "AUDITOR"));
  const hrUser = await user(t, "HR_ADMIN");
  const hr = await ctxOf(hrUser);
  const guard = await createEmployee(hr, { firstName: "Gbenga", lastName: "Supported", employmentDate: "2023-01-05", categoryId: t.guardId });
  const me = await ctxOf(await user(t, "EMPLOYEE", guard.id));
  // an officer is a user whose role is changed by the Company Administrator
  const newOfficer = async (extra: { external?: boolean; accessEndsOn?: string } = {}) => {
    const u = await user(t, "EMPLOYEE");
    await appointOfficer(boss, u.id, extra);
    return u;
  };
  const officer = async (functions: Array<"WELFARE" | "SURVEYS" | "SURVEY_ASSIST" | "SUCCESSION">, extra: { external?: boolean; accessEndsOn?: string } = {}) => {
    const u = await newOfficer(extra);
    for (const f of functions) await grantFunction(boss, { userId: u.id, function: f, reason: "outsourced HR support" });
    return { u, ctx: async () => ctxOf({ ...u, role: "HR_OFFICER" }) };
  };
  const welfareCase = () => raiseCase(me, { type: "WELFARE", welfareKind: "BEREAVEMENT", summary: "Death of my mother", description: SECRET } as never);
  return { t, boss, auditor, hr, hrUser, guard, me, officer, newOfficer, welfareCase };
}

describe("appointing and granting", () => {
  it("is done by the Company Administrator alone: the HR administrator, a manager, the auditor and an employee are refused", async () => {
    const w = await world();
    const u = await user(w.t, "EMPLOYEE");
    for (const ctx of [w.hr, w.auditor, w.me]) {
      await expect(appointOfficer(ctx, u.id, {}), ctx.role).rejects.toThrow(/permission/);
    }
    await appointOfficer(w.boss, u.id, {});
    for (const ctx of [w.hr, w.auditor, w.me]) {
      await expect(grantFunction(ctx, { userId: u.id, function: "SURVEYS", reason: "needed for the survey" }), ctx.role).rejects.toThrow(/permission/);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("HR_OFFICER");
  });
  it("cannot make an administrator, an HR administrator or oneself an officer, and cannot grant to anyone who is not an officer", async () => {
    const w = await world();
    const bossUser = await db.user.findFirstOrThrow({ where: { organizationId: w.t.org.id, role: "COMPANY_ADMIN" } });
    await expect(appointOfficer(w.boss, bossUser.id, {})).rejects.toThrow(/administrator|yourself/i);
    await expect(appointOfficer(w.boss, w.hrUser.id, {})).rejects.toThrow(/administrator/i);
    await expect(grantFunction(w.boss, { userId: w.hrUser.id, function: "WELFARE", reason: "should not work" })).rejects.toThrow(/officer/i);
    await expect(grantFunction(w.boss, { userId: bossUser.id, function: "WELFARE", reason: "to myself" })).rejects.toThrow(/officer/i);
  });
  it("needs a reason, a function from the fixed list, an officer of this company, and refuses the same live function twice", async () => {
    const w = await world();
    const o = await w.newOfficer();
    await expect(grantFunction(w.boss, { userId: o.id, function: "WELFARE", reason: "no" })).rejects.toThrow();
    await expect(grantFunction(w.boss, { userId: o.id, function: "PAYROLL" as never, reason: "not a real function" })).rejects.toThrow();
    await grantFunction(w.boss, { userId: o.id, function: "WELFARE", reason: "outsourced HR support" });
    await expect(grantFunction(w.boss, { userId: o.id, function: "WELFARE", reason: "outsourced HR support" })).rejects.toThrow(/already/i);
    const other = await world();
    await expect(grantFunction(other.boss, { userId: o.id, function: "SURVEYS", reason: "another company" })).rejects.toThrow(/not found/i);
  });
});

describe("what an officer can do", () => {
  it("is nothing in HR until a function is granted", async () => {
    const w = await world();
    const o = await w.officer([]);
    const ctx = await o.ctx();
    await expect(listSurveys(ctx)).rejects.toThrow(/permission/);
    await expect(createSurvey(ctx, { title: "A survey", opensOn: today(), closesOn: today() } as never)).rejects.toThrow(/permission/);
    await expect(welfareSummary(ctx, {})).rejects.toThrow(/permission/);
    await expect(successionOverview(ctx)).rejects.toThrow(/permission/);
    await expect(listCases(ctx, {})).rejects.toThrow(/permission/);
  });
  it("is exactly the function granted: surveys open surveys and nothing else, succession opens succession and nothing else, welfare opens welfare and nothing else", async () => {
    const w = await world();
    const surveys = await (await w.officer(["SURVEYS"])).ctx();
    expect((await createSurvey(surveys, { title: "A survey", opensOn: today(), closesOn: today() } as never)).status).toBe("DRAFT");
    await expect(welfareSummary(surveys, {})).rejects.toThrow(/permission/);
    await expect(successionOverview(surveys)).rejects.toThrow(/permission/);
    const succession = await (await w.officer(["SUCCESSION"])).ctx();
    expect(await successionOverview(succession)).toEqual([]);
    await expect(createSurvey(succession, { title: "A survey", opensOn: today(), closesOn: today() } as never)).rejects.toThrow(/permission/);
    const welfare = await (await w.officer(["WELFARE"])).ctx();
    expect((await welfareSummary(welfare, {})).total).toBe(0);
    await expect(successionOverview(welfare)).rejects.toThrow(/permission/);
    await expect(addSuccessionRole(welfare, w.t.guardId)).rejects.toThrow(/permission/);
  });
  it("can be given several functions, and one more later", async () => {
    const w = await world();
    const o = await w.officer(["SURVEYS", "SUCCESSION"]);
    const ctx = await o.ctx();
    expect(await successionOverview(ctx)).toEqual([]);
    await grantFunction(w.boss, { userId: o.u.id, function: "WELFARE", reason: "now also welfare" });
    expect((await welfareSummary(await o.ctx(), {})).total).toBe(0);
  });
});

describe("the welfare function without any wider HR access", () => {
  it("reads and works a welfare case, and sees only welfare cases: not a grievance, not misconduct", async () => {
    const w = await world();
    const c = await w.welfareCase();
    const grievance = await raiseCase(w.me, { type: "GRIEVANCE", summary: "A grievance", description: "Details of the grievance" } as never);
    const ctx = await (await w.officer(["WELFARE"])).ctx();
    expect((await listCases(ctx, {})).map((x) => x.id)).toEqual([c.id]);
    expect(await getCase(ctx, c.id)).toMatchObject({ redacted: false, description: SECRET });
    await expect(getCase(ctx, grievance.id)).rejects.toThrow(/not found/i);
    await assignCase(ctx, c.id, "Ngozi (HR consultant)");
    await setCaseStatus(ctx, c.id, "INVESTIGATING");
    await addCaseNote(ctx, c.id, { kind: "NOTE", note: "Five days' compassionate leave agreed" });
    expect((await resolveCase(ctx, c.id, { outcome: "RESOLVED_INFORMALLY", resolution: "Leave agreed and support offered" })).status).toBe("RESOLVED");
    expect((await closeCase(ctx, c.id)).status).toBe("CLOSED");
    await expect(addCaseNote(ctx, grievance.id, { kind: "NOTE", note: "Not mine to work" })).rejects.toThrow(/not found/i);
  });
  it("does not let the Company Administrator, the auditor, an officer without the function or another company read or work it", async () => {
    const w = await world();
    const c = await w.welfareCase();
    const none = await (await w.officer(["SURVEYS"])).ctx();
    for (const ctx of [w.boss, w.auditor, none, await ctxOf(await user(w.t, "SUPERVISOR"))]) {
      await expect(getCase(ctx, c.id), ctx.role).rejects.toThrow();
      await expect(addCaseNote(ctx, c.id, { kind: "NOTE", note: "Trying to add a note" }), ctx.role).rejects.toThrow();
    }
    const o = await world();
    await expect(getCase(await (await o.officer(["WELFARE"])).ctx(), c.id)).rejects.toThrow(/not found/i);
  });
});

describe("a grant that is revoked, expired or removed", () => {
  it("stops working on the very next request", async () => {
    const w = await world();
    const o = await w.officer(["SUCCESSION"]);
    expect(await successionOverview(await o.ctx())).toEqual([]);
    const grant = await db.userFunctionGrant.findFirstOrThrow({ where: { userId: o.u.id } });
    await revokeFunction(w.boss, grant.id, "the engagement has ended");
    await expect(successionOverview(await o.ctx())).rejects.toThrow(/permission/);
    expect(await db.userFunctionGrant.findUniqueOrThrow({ where: { id: grant.id } })).toMatchObject({ revokeReason: "the engagement has ended" });
    await expect(revokeFunction(w.boss, grant.id, "again please")).rejects.toThrow(/already/i);
    await expect(revokeFunction(w.hr, grant.id, "not mine to revoke")).rejects.toThrow(/permission/);
  });
  it("does not count after its end date, and the end date itself still counts", async () => {
    const w = await world();
    const o = await w.newOfficer();
    await grantFunction(w.boss, { userId: o.id, function: "SUCCESSION", reason: "temporary cover", endsOn: today() });
    expect(await loadGrantPermissions(o.id)).toEqual(["succession.manage"]);
    await db.userFunctionGrant.updateMany({ where: { userId: o.id }, data: { endsOn: addDays(todayUtc(), -1) } });
    expect(await loadGrantPermissions(o.id)).toEqual([]);
  });
  it("is all removed when the officer is removed, and their sign-in ends", async () => {
    const w = await world();
    const o = await w.officer(["WELFARE", "SURVEYS"]);
    await removeOfficer(w.boss, o.u.id);
    expect(await loadGrantPermissions(o.u.id)).toEqual([]);
    const after = await db.user.findUniqueOrThrow({ where: { id: o.u.id } });
    expect(after.active).toBe(false);
    expect(after.sessionVersion).toBeGreaterThan(o.u.sessionVersion);
  });
});

describe("an external officer", () => {
  it("needs an end date, is flagged, and cannot be given an end date in the past", async () => {
    const w = await world();
    const u = await user(w.t, "EMPLOYEE");
    await expect(appointOfficer(w.boss, u.id, { external: true })).rejects.toThrow(/end date/i);
    await expect(appointOfficer(w.boss, u.id, { external: true, accessEndsOn: iso(addDays(todayUtc(), -1)) })).rejects.toThrow(/past/i);
    await appointOfficer(w.boss, u.id, { external: true, accessEndsOn: iso(addDays(todayUtc(), 90)) });
    expect(await db.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ role: "HR_OFFICER", external: true });
  });
  it("cannot be granted a function past the day their access ends", async () => {
    const w = await world();
    const o = await w.newOfficer({ external: true, accessEndsOn: iso(addDays(todayUtc(), 10)) });
    await expect(grantFunction(w.boss, { userId: o.id, function: "SURVEYS", reason: "outsourced HR support", endsOn: iso(addDays(todayUtc(), 20)) })).rejects.toThrow(/access ends/i);
    await grantFunction(w.boss, { userId: o.id, function: "SURVEYS", reason: "outsourced HR support", endsOn: iso(addDays(todayUtc(), 5)) });
  });
});

describe("the notice for the Company Administrator", () => {
  it("lists the functions nobody holds: all four with no HR administrator, fewer as officers are given functions, none once there is an HR administrator", async () => {
    const t = await isolatedOrg();
    const boss = await ctxOf(await user(t, "COMPANY_ADMIN"));
    expect(await unheldFunctionsFor(boss)).toEqual(["WELFARE", "SURVEYS", "SURVEY_ASSIST", "SUCCESSION"]);
    const u = await user(t, "EMPLOYEE");
    await appointOfficer(boss, u.id, {});
    await grantFunction(boss, { userId: u.id, function: "WELFARE", reason: "outsourced HR support" });
    expect(await unheldFunctionsFor(boss)).toEqual(["SURVEYS", "SURVEY_ASSIST", "SUCCESSION"]);
    await user(t, "HR_ADMIN");
    expect(await unheldFunctionsFor(boss)).toEqual([]);
    await expect(unheldFunctionsFor(await ctxOf(await user(t, "EMPLOYEE")))).rejects.toThrow(/permission/);
  });
  it("does not count an officer whose grant has ended or whose account is inactive", async () => {
    const t = await isolatedOrg(); // a company with no HR administrator
    const boss = await ctxOf(await user(t, "COMPANY_ADMIN"));
    const u = await user(t, "EMPLOYEE");
    await appointOfficer(boss, u.id, {});
    await grantFunction(boss, { userId: u.id, function: "SUCCESSION", reason: "temporary cover" });
    expect(await unheldFunctionsFor(boss)).not.toContain("SUCCESSION");
    await removeOfficer(boss, u.id);
    expect(await unheldFunctionsFor(boss)).toContain("SUCCESSION");
  });
});

describe("the list of officers, and the audit log", () => {
  it("shows each officer's live functions to the Company Administrator, and nothing to anyone else", async () => {
    const w = await world();
    const o = await w.officer(["WELFARE"], { external: true, accessEndsOn: iso(addDays(todayUtc(), 30)) });
    const rows = await listOfficers(w.boss);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: o.u.id, external: true, functions: ["WELFARE"] });
    for (const ctx of [w.hr, w.auditor, w.me]) await expect(listOfficers(ctx), ctx.role).rejects.toThrow(/permission/);
    const other = await world();
    expect(await listOfficers(other.boss)).toEqual([]);
  });
  it("records every appointment, grant, revocation and removal by ids and the function name, never the reason", async () => {
    const w = await world();
    const o = await w.officer(["SURVEYS"]);
    const grant = await db.userFunctionGrant.findFirstOrThrow({ where: { userId: o.u.id } });
    await revokeFunction(w.boss, grant.id, "SECRET-REASON the engagement has ended");
    await removeOfficer(w.boss, o.u.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "HR_OFFICER_" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["HR_OFFICER_APPOINT", "HR_OFFICER_FUNCTION_GRANT", "HR_OFFICER_FUNCTION_REVOKE", "HR_OFFICER_REMOVE"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|outsourced HR support/);
  });
});

describe("tenant isolation", () => {
  it("another company's administrator cannot appoint, grant, revoke or remove here", async () => {
    const w = await world();
    const o = await w.officer(["SURVEYS"]);
    const other = await world();
    await expect(appointOfficer(other.boss, o.u.id, {})).rejects.toThrow(/not found/i);
    const grant = await db.userFunctionGrant.findFirstOrThrow({ where: { userId: o.u.id } });
    await expect(revokeFunction(other.boss, grant.id, "not my company")).rejects.toThrow(/not found/i);
    await expect(removeOfficer(other.boss, o.u.id)).rejects.toThrow(/not found/i);
  });
});

describe("signing in", () => {
  it("a Delegated HR Officer must use two-factor sign-in: blocked until they enrol, with no grace period", async () => {
    const w = await world();
    const o = await w.officer(["WELFARE"]);
    const who = { userId: o.u.id, orgId: w.t.org.id, role: "HR_OFFICER" };
    expect((await twoFactorStateFor(who)).state).toBe("BLOCKED");
    await db.user.update({ where: { id: o.u.id }, data: { totpEnabled: true } });
    expect((await twoFactorStateFor(who)).state).toBe("ENROLLED");
  });
  it("an outsourced officer cannot sign in after their end date, but can on the day itself", async () => {
    const w = await world();
    const email = `ext-${uid()}@gov.test`.toLowerCase();
    const u = await db.user.create({ data: { organizationId: w.t.org.id, email, name: "Outsourced Officer", role: "EMPLOYEE", passwordHash: await bcrypt.hash("a-long-test-password", 4) } });
    await appointOfficer(w.boss, u.id, { external: true, accessEndsOn: today() });
    expect((await authenticate(email, "a-long-test-password"))?.id).toBe(u.id); // the end day itself still works
    await db.user.update({ where: { id: u.id }, data: { accessEndsOn: new Date(`${iso(addDays(todayUtc(), -1))}T00:00:00Z`) } });
    expect(await authenticate(email, "a-long-test-password")).toBeNull();
  });
});

describe("switched-off accounts", () => {
  it("appointing never switches a deactivated account back on, and an ended appointment cannot be granted a function", async () => {
    const w = await world();
    const off = await user(w.t, "EMPLOYEE", null, { active: false });
    await expect(appointOfficer(w.boss, off.id, {})).rejects.toThrow(/switched off/i);
    expect((await db.user.findUniqueOrThrow({ where: { id: off.id } })).active).toBe(false);
    const o = await w.officer(["WELFARE"]);
    await removeOfficer(w.boss, o.u.id);
    await expect(grantFunction(w.boss, { userId: o.u.id, function: "SURVEYS", reason: "after the appointment ended" })).rejects.toThrow(/ended/i);
  });
});
