import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { addCaseNote, assignCase, caseStats, getCase, listCases, myCases, raiseCase, resolveCase } from "@/server/services/relations";
import { welfareSummary } from "@/server/services/welfare";
import { employeeTimeline } from "@/server/services/hr-overview";
import { buildHrDigest } from "@/server/services/reminders";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { isolatedOrg, uid } from "../helpers";

// Welfare and recognition, step 1: welfare support requests (the founder's go of 2026-11-10; plan docs/plans/welfare-recognition-plan.md).
// Welfare support is a case of a new always-confidential type, handled only by people with the narrower welfare.manage right; everyone else is told nothing about it.

const SECRET = "SECRET-WELFARE my mother died and I need time off";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@wel.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const boss = await login(t, "COMPANY_ADMIN");
  const guard = await createEmployee(hr, { firstName: "Gbenga", lastName: "Supported", employmentDate: "2023-01-05", categoryId: t.guardId });
  const other = await createEmployee(hr, { firstName: "Hauwa", lastName: "Other", employmentDate: "2023-01-05", categoryId: t.guardId });
  const me = await login(t, "EMPLOYEE", guard.id);
  const meOther = await login(t, "EMPLOYEE", other.id);
  const raise = (ctx: Ctx, over: Record<string, unknown> = {}) =>
    raiseCase(ctx, { type: "WELFARE", welfareKind: "BEREAVEMENT", summary: "Death of my mother", description: SECRET, ...over } as never);
  const welfareCase = (over: Record<string, unknown> = {}) => raise(me, over);
  return { t, hr, boss, guard, other, me, meOther, raise, welfareCase };
}
type W = Awaited<ReturnType<typeof world>>;
/** Roles that read HR records but must not see welfare cases. */
const readers = async (w: W) => [await login(w.t, "AUDITOR"), await login(w.t, "FINANCE")];

describe("raising a welfare case", () => {
  it("an employee raises one for themselves with a kind; it is always confidential and open", async () => {
    const w = await world();
    const c = await w.welfareCase();
    expect(c).toMatchObject({ type: "WELFARE", welfareKind: "BEREAVEMENT", confidential: true, status: "OPEN", selfRaised: true, employeeId: w.guard.id });
    expect((await w.welfareCase({ summary: "Help with a hard time at home", welfareKind: "FAMILY", confidential: false })).confidential).toBe(true); // cannot be made non-confidential
  });
  it("needs a kind from the fixed list", async () => {
    const w = await world();
    await expect(w.welfareCase({ welfareKind: undefined })).rejects.toThrow(/kind of support/i);
    await expect(w.welfareCase({ welfareKind: "GOSSIP" })).rejects.toThrow();
  });
  it("HR raises one on an employee's behalf, and only someone with the welfare right may", async () => {
    const w = await world();
    const c = await w.raise(w.hr, { employeeId: w.guard.id });
    expect(c).toMatchObject({ type: "WELFARE", selfRaised: false, employeeId: w.guard.id });
    await expect(w.raise(w.hr, {})).rejects.toThrow(/choose the employee/i);
  });
  it("only a welfare case carries a kind: other case types are unchanged", async () => {
    const w = await world();
    const g = await raiseCase(w.me, { type: "GRIEVANCE", summary: "Unfair shift allocation", description: "My shifts were changed without notice." } as never);
    expect(g).toMatchObject({ type: "GRIEVANCE", welfareKind: null, confidential: false });
  });
  it("the employee sees their own case's status and outcome, never the handler's notes", async () => {
    const w = await world();
    const c = await w.welfareCase();
    await addCaseNote(w.hr, c.id, { kind: "NOTE", note: "SECRET-NOTE referred to the staff counsellor" });
    const mine = await myCases(w.me);
    expect(mine.map((x) => x.id)).toEqual([c.id]);
    expect(JSON.stringify(mine)).not.toContain("SECRET-NOTE");
    expect(await myCases(w.meOther)).toEqual([]);
  });
});

describe("who may read and work a welfare case", () => {
  it("HR and the administrators (the welfare right) read it in full", async () => {
    const w = await world();
    const c = await w.welfareCase();
    for (const ctx of [w.hr, w.boss]) {
      expect((await listCases(ctx, {})).find((x) => x.id === c.id)).toMatchObject({ summary: "Death of my mother" });
      expect(await getCase(ctx, c.id)).toMatchObject({ redacted: false, description: SECRET });
    }
  });
  it("anyone else who reads HR records is not told it exists: not in a list, a count, a search or by its id", async () => {
    const w = await world();
    const c = await w.welfareCase();
    await w.welfareCase({ summary: "Another request for help" });
    for (const ctx of await readers(w)) {
      expect((await listCases(ctx, {})).map((x) => x.id), ctx.role).not.toContain(c.id);
      expect(await listCases(ctx, { q: "mother" }), ctx.role).toEqual([]);
      expect(await listCases(ctx, { type: "WELFARE" }), ctx.role).toEqual([]);
      await expect(getCase(ctx, c.id), ctx.role).rejects.toThrow(/case not found/i);
      expect((await caseStats(ctx)).byType.WELFARE, ctx.role).toBeUndefined();
    }
    expect((await caseStats(w.hr)).byType.WELFARE).toBe(2); // HR counts them
  });
  it("only the welfare right works a case: assigning, noting and resolving", async () => {
    const w = await world();
    const c = await w.welfareCase();
    for (const ctx of await readers(w)) {
      await expect(addCaseNote(ctx, c.id, { kind: "NOTE", note: "Trying to add a note" }), ctx.role).rejects.toThrow();
      await expect(assignCase(ctx, c.id, "Me"), ctx.role).rejects.toThrow();
      await expect(resolveCase(ctx, c.id, { outcome: "RESOLVED_INFORMALLY", resolution: "Trying to resolve it myself" }), ctx.role).rejects.toThrow();
    }
    await assignCase(w.hr, c.id, "Halima (HR)");
    await addCaseNote(w.hr, c.id, { kind: "NOTE", note: "Five days' compassionate leave agreed" });
    expect((await resolveCase(w.hr, c.id, { outcome: "RESOLVED_INFORMALLY", resolution: "Leave agreed and support offered" })).status).toBe("RESOLVED");
  });
  it("another employee cannot see it, and another company sees nothing", async () => {
    const w = await world();
    const c = await w.welfareCase();
    expect(await myCases(w.meOther)).toEqual([]);
    await expect(getCase(w.meOther, c.id)).rejects.toThrow(/permission/);
    const o = await world();
    expect(await listCases(o.hr, {})).toEqual([]);
    await expect(getCase(o.hr, c.id)).rejects.toThrow(/case not found/i);
  });
});

describe("it stays out of the digest and the timeline", () => {
  it("the HR digest never lists a welfare case, however close its deadline", async () => {
    const w = await world();
    const c = await w.welfareCase({ summary: "SECRET-SUMMARY hardship" });
    await db.relationsCase.update({ where: { id: c.id }, data: { dueDate: new Date(Date.now() - 5 * 86_400_000) } }); // overdue
    const digest = await buildHrDigest(w.t.org.id);
    expect(JSON.stringify(digest)).not.toContain("SECRET-SUMMARY");
    expect(JSON.stringify(digest)).not.toMatch(/welfare/i);
    expect(digest.sections.find((s) => s.key === "cases")).toBeUndefined();
  });
  it("an employee's timeline shows it to the welfare right and to no one else", async () => {
    const w = await world();
    const c = await w.welfareCase();
    expect((await employeeTimeline(w.hr, w.guard.id)).some((e) => e.title.includes(c.caseNumber))).toBe(true);
    for (const ctx of await readers(w)) expect((await employeeTimeline(ctx, w.guard.id)).some((e) => e.title.includes(c.caseNumber)), ctx.role).toBe(false);
  });
});

describe("welfare handles no money", () => {
  it("raising, working and resolving a case never creates or approves a loan or an advance", async () => {
    const w = await world();
    const c = await w.welfareCase({ welfareKind: "FINANCIAL_HARDSHIP", summary: "Need help with school fees" });
    await addCaseNote(w.hr, c.id, { kind: "NOTE", note: "Told to apply through staff loans" });
    await resolveCase(w.hr, c.id, { outcome: "RESOLVED_INFORMALLY", resolution: "Referred to the staff loans process" });
    expect(await db.staffLoan.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
});

describe("counts without names", () => {
  async function fill(w: W, kind: string, n: number, openedAt = new Date()) {
    for (let i = 0; i < n; i++) {
      const c = await w.welfareCase({ welfareKind: kind, summary: `Support request ${i} ${uid()}` });
      await db.relationsCase.update({ where: { id: c.id }, data: { openedAt } });
    }
  }
  it("shows each kind's count for the year, hiding any group of fewer than 5", async () => {
    const w = await world();
    await fill(w, "BEREAVEMENT", 6);
    await fill(w, "FAMILY", 2);
    const r = await welfareSummary(w.hr, {});
    expect(r.byKind.find((k) => k.kind === "BEREAVEMENT")).toMatchObject({ count: 6 });
    expect(r.byKind.find((k) => k.kind === "FAMILY")).toMatchObject({ count: null }); // fewer than 5
    expect(r.byKind.find((k) => k.kind === "HEALTH_WELLBEING")).toMatchObject({ count: 0 });
    expect(r.total).toBe(8);
    expect(JSON.stringify(r)).not.toContain(w.guard.id); // no names, no ids
  });
  it("shows no total and no kind when fewer than 5 cases in all, and counts only the year asked for", async () => {
    const w = await world();
    await fill(w, "BEREAVEMENT", 3);
    expect((await welfareSummary(w.hr, {})).total).toBeNull();
    await fill(w, "BEREAVEMENT", 6, new Date("2024-06-01"));
    const thisYear = await welfareSummary(w.hr, {});
    expect(thisYear.byKind.find((k) => k.kind === "BEREAVEMENT")!.count).toBeNull(); // the 6 are in 2024
    expect((await welfareSummary(w.hr, { year: 2024 })).byKind.find((k) => k.kind === "BEREAVEMENT")!.count).toBe(6);
  });
  it("is for the welfare right alone, and another company's cases are its own", async () => {
    const w = await world();
    await fill(w, "BEREAVEMENT", 6);
    for (const ctx of [...(await readers(w)), w.me]) await expect(welfareSummary(ctx, {}), ctx.role).rejects.toThrow(/permission/);
    expect((await welfareSummary((await world()).hr, {})).total).toBe(0); // nothing: another company's cases are its own
  });
});

describe("audit and erasure", () => {
  it("raising is recorded by ids, never what the request says", async () => {
    const w = await world();
    const c = await w.welfareCase();
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: c.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("SECRET-WELFARE");
    expect(JSON.stringify(rows)).not.toContain("Death of my mother");
  });
  it("erasing an employee removes the words in their welfare case and its notes, and keeps the shape", async () => {
    const w = await world();
    const c = await w.welfareCase();
    await addCaseNote(w.hr, c.id, { kind: "NOTE", note: "SECRET-NOTE counsellor referral" });
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.guard.id, new Date()));
    const after = await db.relationsCase.findUniqueOrThrow({ where: { id: c.id }, include: { notes: true } });
    expect(JSON.stringify(after)).not.toContain("SECRET-WELFARE");
    expect(JSON.stringify(after)).not.toContain("SECRET-NOTE");
    expect(after).toMatchObject({ type: "WELFARE", welfareKind: "BEREAVEMENT", status: "OPEN" }); // the shape stays
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});
