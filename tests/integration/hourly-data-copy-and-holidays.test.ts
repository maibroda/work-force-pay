import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { compileEmployeeData } from "@/server/services/data-requests";
import { createEmployee } from "@/server/services/employees";
import { holidayContext } from "@/server/services/holidays";
import { approveTimeEntry, captureTimeEntry, submitTimeEntry } from "@/server/services/time-entries";
import { isolatedOrg, uid } from "../helpers";

/**
 * Two follow-ups to hourly pay, on the founder's answers of 2026-11-19. H17: a contract's "working days, public holidays excluded" paid-days basis considers only NATIONAL holidays, so a holiday limited to states
 * (which hourly pay uses by the state of the work location) never removes a working day from every contract. And a person's own data copy lists their hourly shifts (the finding of phase 3).
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("H17: the contract paid-days basis considers only national holidays", () => {
  it("a holiday with no states counts; a holiday limited to states does not (it is for hourly pay, by the state of the work location)", async () => {
    const t = await isolatedOrg();
    const national = await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day("2026-10-01"), name: "A national holiday", createdBy: "t" } });
    const lagos = await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day("2026-11-02"), name: "A Lagos holiday", createdBy: "t" } });
    await db.publicHolidayState.create({ data: { organizationId: t.org.id, holidayId: lagos.id, state: "Lagos", createdBy: "t" } });
    const both = await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day("2026-12-25"), name: "Christmas", createdBy: "t" } });
    expect(national.id && both.id).toBeTruthy();
    const ctx = await holidayContext(db, t.org.id, 2026);
    expect([...ctx.holidays].sort()).toEqual(["2026-10-01", "2026-12-25"]);
  });

  it("a company that never limits a holiday to states gets exactly the list it always had", async () => {
    const t = await isolatedOrg();
    for (const date of ["2026-01-01", "2026-05-01", "2026-10-01"]) await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day(date), name: `Holiday ${date}`, createdBy: "t" } });
    expect([...(await holidayContext(db, t.org.id, 2026)).holidays].sort()).toEqual(["2026-01-01", "2026-05-01", "2026-10-01"]);
  });

  it("limiting a holiday to states and then making it national again puts it back", async () => {
    const t = await isolatedOrg();
    const h = await db.publicHoliday.create({ data: { organizationId: t.org.id, date: day("2026-11-02"), name: "A holiday", createdBy: "t" } });
    const s = await db.publicHolidayState.create({ data: { organizationId: t.org.id, holidayId: h.id, state: "Lagos", createdBy: "t" } });
    expect((await holidayContext(db, t.org.id, 2026)).holidays).toEqual([]);
    await db.publicHolidayState.delete({ where: { id: s.id } });
    expect((await holidayContext(db, t.org.id, 2026)).holidays).toEqual(["2026-11-02"]);
  });
});

describe("a person's own data copy lists their hourly shifts", () => {
  async function world() {
    const t = await isolatedOrg();
    await db.hourlyPaySetting.create({ data: { organizationId: t.org.id, enabled: true, changedBy: "test", changedByUserId: "test" } });
    const sup = t.ctx("SUPERVISOR", null, 1);
    await db.user.create({ data: { id: sup.userId, organizationId: t.org.id, email: sup.email, name: sup.name, passwordHash: "x", role: "SUPERVISOR" } });
    const ops = t.ctx("OPERATIONS", null, 1);
    const hr = t.ctx("HR_ADMIN");
    const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Alpha Bank" } });
    const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Alpha guarding", startDate: day("2026-01-01") } });
    const beat = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: "Lagos HQ", state: "Lagos", supervisorId: sup.userId } });
    const hourly = async (n: string) => {
      const e = await createEmployee(hr, { firstName: "Hourly", lastName: n, employmentDate: "2026-01-01", categoryId: t.guardId } as never);
      await db.employeeCompensationType.create({ data: { organizationId: t.org.id, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2026-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
      return e;
    };
    return { t, sup, ops, beat, hourly };
  }

  it("shows the person's shifts (the site, the times in Nigerian time, the status and the approved hours) and never anyone else's", async () => {
    const w = await world();
    const me = await w.hourly("Me");
    const other = await w.hourly("Other");
    const a = await captureTimeEntry(w.ops, { employeeId: me.id, beatId: w.beat.id, clockIn: "2026-11-20T19:00", clockOut: "2026-11-21T07:00" });
    await submitTimeEntry(w.ops, a.id);
    await approveTimeEntry(w.sup, a.id, { breaks: "02:00-02:30" });
    await captureTimeEntry(w.ops, { employeeId: me.id, beatId: w.beat.id, clockIn: "2026-11-23T08:00", clockOut: null }); // a draft with no clock-out
    const b = await captureTimeEntry(w.ops, { employeeId: other.id, beatId: w.beat.id, clockIn: "2026-11-20T19:00", clockOut: "2026-11-21T07:00" });
    await submitTimeEntry(w.ops, b.id);
    const out = await compileEmployeeData(w.t.org.id, me.id);
    const s = out.sections.hourlyShifts;
    expect(s.records).toHaveLength(2);
    expect(s.records[0]).toMatchObject({ site: "Lagos HQ", clockIn: "2026-11-20 19:00", clockOut: "2026-11-21 07:00", status: "approved", approvedHours: 11.5 });
    expect(s.records[1]).toMatchObject({ clockIn: "2026-11-23 08:00", clockOut: "not entered", status: "draft", approvedHours: null });
    expect(JSON.stringify(out)).not.toContain("Hourly Other"); // nobody else's name or shifts are in the copy
  });

  it("leaves out the words typed about a shift (a rejection note, a correction reason): only the facts are in the copy", async () => {
    const w = await world();
    const me = await w.hourly("Me");
    const e = await captureTimeEntry(w.ops, { employeeId: me.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" });
    await submitTimeEntry(w.ops, e.id);
    const { rejectTimeEntry } = await import("@/server/services/time-entries");
    await rejectTimeEntry(w.sup, e.id, "SECRET-REJECTION-NOTE suspected padding of hours");
    const text = JSON.stringify(await compileEmployeeData(w.t.org.id, me.id));
    expect(text).not.toContain("SECRET-REJECTION-NOTE");
    expect(JSON.stringify((await compileEmployeeData(w.t.org.id, me.id)).sections.hourlyShifts.records)).toContain("rejected");
  });

  it("a person with no hourly shifts has an empty section, and another company's person has none of this company's", async () => {
    const a = await world();
    const b = await world();
    const mine = await a.hourly("Mine");
    const theirs = await b.hourly("Theirs");
    const e = await captureTimeEntry(a.ops, { employeeId: mine.id, beatId: a.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" });
    expect(e.id).toBeTruthy();
    expect((await compileEmployeeData(b.t.org.id, theirs.id)).sections.hourlyShifts.records).toEqual([]);
  });
});
