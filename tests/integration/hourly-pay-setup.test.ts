import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { resolveHourlyRate, compensationTypeOn } from "@/lib/payroll/hourly-rates";
import { addHoliday, confirmHolidayYear } from "@/server/services/holidays";
import { createEmployee } from "@/server/services/employees";
import {
  approveCompensationType,
  approveHourlyRate,
  cancelHourlyRate,
  compensationTypeFor,
  holidayDatesAt,
  hourlyPayEnabled,
  listCompensationTypes,
  listHourlyRates,
  loadApprovedHourlyRates,
  proposeCompensationType,
  proposeHourlyRate,
  rejectCompensationType,
  rejectHourlyRate,
  setHolidayStates,
  setHourlyPayEnabled,
} from "@/server/services/hourly-pay";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 2 (docs/plans/hourly-payroll-assessment.md; the founder's answers of 2026-11-19): the company switch (OFF until switched on), effective-dated hourly rates proposed by one person and approved by
 * another, how a person is paid from a date, and public holidays limited to states (the state of the WORK LOCATION decides, H11). Nothing here reads the pay run yet. The rates are INVENTED for the tests.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  const maker = t.ctx("PAYROLL_ADMIN", null, 1);
  const checker = t.ctx("COMPANY_ADMIN", null, 2);
  const admin = t.ctx("COMPANY_ADMIN", null, 3);
  const hr = t.ctx("HR_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Hourly", lastName: "Person", employmentDate: "2026-01-01", categoryId: t.guardId } as never);
  const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Alpha Bank" } });
  const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Alpha guarding", startDate: day("2026-01-01") } });
  const ask = (over: Record<string, unknown> = {}) => ({ scope: "CATEGORY", categoryId: t.guardId, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: "2026-11-01", reason: "Agreed with the client", ...over });
  const on = async () => setHourlyPayEnabled(admin, true);
  const audit = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  return { t, maker, checker, admin, hr, emp, client, contract, ask, on, audit };
}

describe("the company switch: hourly pay is OFF until a company administrator switches it on", () => {
  it("is off for a company that has never touched it, and every hourly action refuses with a plain message", async () => {
    const w = await world();
    expect(await hourlyPayEnabled(w.t.org.id)).toBe(false);
    await expect(proposeHourlyRate(w.maker, w.ask())).rejects.toThrow(/not switched on/i);
    await expect(proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-11-01", reason: "Moves to hourly pay" })).rejects.toThrow(/not switched on/i);
    const h = await addHoliday(w.maker, { date: "2026-12-25", name: "Christmas Day" });
    await expect(setHolidayStates(w.maker, h.id, ["Lagos"])).rejects.toThrow(/not switched on/i);
    await expect(listHourlyRates(w.maker)).rejects.toThrow(/not switched on/i);
  });

  it("only someone with the settings right may switch it, and switching is recorded by the fact, not words", async () => {
    const w = await world();
    expect(can("AUDITOR", "settings.manage")).toBe(false);
    await expect(setHourlyPayEnabled(w.t.ctx("AUDITOR"), true)).rejects.toThrow(/permission/);
    await expect(setHourlyPayEnabled(w.maker, true)).rejects.toThrow(/permission/); // the payroll officer proposes rates, it does not switch the module on
    await setHourlyPayEnabled(w.admin, true);
    expect(await hourlyPayEnabled(w.t.org.id)).toBe(true);
    await setHourlyPayEnabled(w.admin, false);
    expect(await hourlyPayEnabled(w.t.org.id)).toBe(false);
    const rows = await w.audit("HOURLY_PAY_SWITCH");
    expect(rows.map((r) => (r.newValue as { enabled: boolean }).enabled)).toEqual([true, false]);
  });

  it("switching one company on leaves every other company off", async () => {
    const a = await world();
    const b = await world();
    await a.on();
    expect(await hourlyPayEnabled(a.t.org.id)).toBe(true);
    expect(await hourlyPayEnabled(b.t.org.id)).toBe(false);
    await expect(proposeHourlyRate(b.maker, b.ask())).rejects.toThrow(/not switched on/i);
  });
});

describe("an hourly rate: proposed by one person, approved by another", () => {
  it("the payroll people propose, nobody else does; a proposal is not a rate until it is approved", async () => {
    const w = await world();
    await w.on();
    for (const r of ["AUDITOR", "SUPERVISOR", "EMPLOYEE", "OPERATIONS"] as const) {
      expect(can(r, "payroll.run"), r).toBe(false);
      await expect(proposeHourlyRate(w.t.ctx(r), w.ask()), r).rejects.toThrow(/permission/);
    }
    const p = await proposeHourlyRate(w.maker, w.ask());
    expect(p).toMatchObject({ status: "PENDING", scope: "CATEGORY", proposedByUserId: w.maker.userId });
    const now = await db.$transaction((tx) => loadApprovedHourlyRates(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")));
    expect(now).toHaveLength(0); // the pay run would see nothing
  });

  it("the person who proposed it cannot approve it, and nor can someone without the approval right, nor a person for their own rate", async () => {
    const w = await world();
    await w.on();
    const p = await proposeHourlyRate(w.maker, w.ask({ scope: "EMPLOYEE", employeeId: w.emp.id, categoryId: undefined }));
    await expect(approveHourlyRate(w.maker, p.id)).rejects.toThrow(/someone else/i);
    await expect(approveHourlyRate(w.t.ctx("HR_ADMIN"), p.id)).rejects.toThrow(/permission/);
    await expect(approveHourlyRate(w.t.ctx("COMPANY_ADMIN", w.emp.id, 4), p.id)).rejects.toThrow(/your own/i);
    await expect(approveHourlyRate(w.checker, p.id)).resolves.toMatchObject({ status: "APPROVED", decidedByUserId: w.checker.userId });
    await expect(approveHourlyRate(w.checker, p.id)).rejects.toThrow(/already approved/i);
  });

  it("approval makes the rate count from its date, and the rate in force is found by the founder's order: the employee, then the contract and role, then the role", async () => {
    const w = await world();
    await w.on();
    const role = await proposeHourlyRate(w.maker, w.ask({ weekdayRate: "1000" }));
    const both = await proposeHourlyRate(w.maker, w.ask({ scope: "CONTRACT_CATEGORY", contractId: w.contract.id, weekdayRate: "2000" }));
    const own = await proposeHourlyRate(w.maker, w.ask({ scope: "EMPLOYEE", employeeId: w.emp.id, categoryId: undefined, weekdayRate: "3000" }));
    const find = async () => {
      const rows = await db.$transaction((tx) => loadApprovedHourlyRates(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")));
      return resolveHourlyRate(rows, { employeeId: w.emp.id, contractId: w.contract.id, categoryId: w.t.guardId, date: day("2026-11-20") });
    };
    expect(await find()).toBeNull();
    await approveHourlyRate(w.checker, role.id);
    expect((await find())?.rates.weekday).toBe(1000);
    await approveHourlyRate(w.checker, both.id);
    expect((await find())?.rates.weekday).toBe(2000);
    await approveHourlyRate(w.checker, own.id);
    expect((await find())?.rates.weekday).toBe(3000);
  });

  it("a change in rate ends the old one the day before the new one starts and keeps both, in order", async () => {
    const w = await world();
    await w.on();
    const first = await proposeHourlyRate(w.maker, w.ask({ effectiveFrom: "2026-01-01", weekdayRate: "1000" }));
    await approveHourlyRate(w.checker, first.id);
    const second = await proposeHourlyRate(w.maker, w.ask({ effectiveFrom: "2026-11-16", weekdayRate: "1200" }));
    await approveHourlyRate(w.checker, second.id);
    const rows = await db.hourlyRate.findMany({ where: { organizationId: w.t.org.id }, orderBy: { effectiveFrom: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].effectiveTo?.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(rows[1].effectiveTo).toBeNull();
    const approved = await db.$transaction((tx) => loadApprovedHourlyRates(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")));
    const on = (iso: string) => resolveHourlyRate(approved, { employeeId: w.emp.id, contractId: null, categoryId: w.t.guardId, date: day(iso) })?.rates.weekday;
    expect([on("2026-11-15"), on("2026-11-16")]).toEqual([1000, 1200]);
  });

  it("an approval that cannot be applied changes nothing: a rate already starts on or after that date", async () => {
    const w = await world();
    await w.on();
    const later = await proposeHourlyRate(w.maker, w.ask({ effectiveFrom: "2026-12-01" }));
    await approveHourlyRate(w.checker, later.id);
    const earlier = await proposeHourlyRate(w.maker, w.ask({ effectiveFrom: "2026-11-01" }));
    await expect(approveHourlyRate(w.checker, earlier.id)).rejects.toThrow(/already starts on or after/i);
    expect((await db.hourlyRate.findUniqueOrThrow({ where: { id: earlier.id } })).status).toBe("PENDING");
    expect((await db.hourlyRate.findUniqueOrThrow({ where: { id: later.id } })).effectiveTo).toBeNull();
  });

  it("rejecting needs a reason, withdrawing is for the proposer only, and neither makes a rate", async () => {
    const w = await world();
    await w.on();
    const p = await proposeHourlyRate(w.maker, w.ask());
    await expect(rejectHourlyRate(w.checker, p.id, "")).rejects.toThrow(/reason/i);
    await expect(cancelHourlyRate(w.checker, p.id)).rejects.toThrow(/only your own/i);
    await expect(cancelHourlyRate(w.maker, p.id)).resolves.toMatchObject({ status: "CANCELLED" });
    const q = await proposeHourlyRate(w.maker, w.ask());
    await expect(rejectHourlyRate(w.checker, q.id, "Not the agreed figure")).resolves.toMatchObject({ status: "REJECTED" });
    expect(await db.$transaction((tx) => loadApprovedHourlyRates(tx, w.t.org.id, day("2026-01-01"), day("2026-12-31")))).toHaveLength(0);
  });

  it("only one pending proposal at a time for the same person, contract-and-role or role", async () => {
    const w = await world();
    await w.on();
    await proposeHourlyRate(w.maker, w.ask());
    await expect(proposeHourlyRate(w.maker, w.ask({ weekdayRate: "1100" }))).rejects.toThrow(/already a pending/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ scope: "EMPLOYEE", employeeId: w.emp.id, categoryId: undefined }))).resolves.toMatchObject({ status: "PENDING" });
  });

  it("refuses rates that are missing, zero, negative or with a part of a kobo, and a scope with the wrong keys", async () => {
    const w = await world();
    await w.on();
    for (const bad of [{ weekdayRate: "" }, { weekendRate: "0" }, { holidayRate: "-5" }, { weekdayRate: "1000.005" }, { weekendRate: "abc" }]) await expect(proposeHourlyRate(w.maker, w.ask(bad)), JSON.stringify(bad)).rejects.toThrow(/hourly rate/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ scope: "EMPLOYEE", employeeId: undefined }))).rejects.toThrow(/employee/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ scope: "CONTRACT_CATEGORY", contractId: undefined }))).rejects.toThrow(/contract/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ scope: "CATEGORY", categoryId: undefined }))).rejects.toThrow(/job role/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ scope: "NOPE" }))).rejects.toThrow(/scope|whom/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ effectiveFrom: "2026-13-40" }))).rejects.toThrow(/date/i);
    await expect(proposeHourlyRate(w.maker, w.ask({ reason: "x" }))).rejects.toThrow(/reason/i);
  });

  it("is recorded in the audit log by ids and rates, never the reason", async () => {
    const w = await world();
    await w.on();
    const p = await proposeHourlyRate(w.maker, w.ask({ reason: "SECRET-RATE-REASON agreed in the bar" }));
    await approveHourlyRate(w.checker, p.id, "SECRET-DECISION-NOTE fine");
    const rows = [...(await w.audit("HOURLY_RATE_PROPOSED")), ...(await w.audit("HOURLY_RATE_APPROVED"))];
    expect(rows).toHaveLength(2);
    expect(rows[0].newValue).toMatchObject({ scope: "CATEGORY", weekdayRate: 1000, weekendRate: 1500, holidayRate: 2000 });
    expect(JSON.stringify(rows)).not.toContain("SECRET-RATE-REASON");
    expect(JSON.stringify(rows)).not.toContain("SECRET-DECISION-NOTE");
  });
});

describe("hourly rates and company walls", () => {
  it("another company's person, contract and job role are 'not found', and its proposals cannot be seen or decided", async () => {
    const a = await world();
    const b = await world();
    await a.on();
    await b.on();
    await expect(proposeHourlyRate(a.maker, a.ask({ scope: "EMPLOYEE", employeeId: b.emp.id, categoryId: undefined }))).rejects.toThrow(/not found/i);
    await expect(proposeHourlyRate(a.maker, a.ask({ scope: "CONTRACT_CATEGORY", contractId: b.contract.id }))).rejects.toThrow(/not found/i);
    await expect(proposeHourlyRate(a.maker, a.ask({ categoryId: b.t.guardId }))).rejects.toThrow(/not found/i);
    const p = await proposeHourlyRate(a.maker, a.ask());
    await expect(approveHourlyRate(b.checker, p.id)).rejects.toThrow(/not found/i);
    await expect(rejectHourlyRate(b.checker, p.id, "no reason at all")).rejects.toThrow(/not found/i);
    expect((await listHourlyRates(b.maker)).rates).toHaveLength(0);
    expect((await listHourlyRates(a.maker)).rates).toHaveLength(1);
  });
});

describe("the database keeps hourly rates as history", () => {
  it("a rate cannot be deleted, a decided rate cannot be edited, and its end date can be set once", async () => {
    const w = await world();
    await w.on();
    const p = await proposeHourlyRate(w.maker, w.ask());
    await approveHourlyRate(w.checker, p.id);
    await expect(db.hourlyRate.delete({ where: { id: p.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.hourlyRate.update({ where: { id: p.id }, data: { weekdayRate: "9999" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.hourlyRate.update({ where: { id: p.id }, data: { status: "REJECTED" } })).rejects.toThrow(/cannot be changed/i);
    await db.hourlyRate.update({ where: { id: p.id }, data: { effectiveTo: day("2026-12-31") } });
    await expect(db.hourlyRate.update({ where: { id: p.id }, data: { effectiveTo: day("2027-06-30") } })).rejects.toThrow(/end date/i);
  });

  it("the database itself refuses a rate with the wrong keys for its scope, a negative rate, and an end before the start", async () => {
    const w = await world();
    const base = { organizationId: w.t.org.id, weekdayRate: "1", weekendRate: "1", holidayRate: "1", effectiveFrom: day("2026-01-01"), reason: "x", proposedBy: "x", proposedByUserId: "x" };
    await expect(db.hourlyRate.create({ data: { ...base, scope: "EMPLOYEE", categoryId: w.t.guardId } })).rejects.toThrow();
    await expect(db.hourlyRate.create({ data: { ...base, scope: "CATEGORY", categoryId: w.t.guardId, employeeId: w.emp.id } })).rejects.toThrow();
    await expect(db.hourlyRate.create({ data: { ...base, scope: "CATEGORY", categoryId: w.t.guardId, weekendRate: "-1" } })).rejects.toThrow();
    await expect(db.hourlyRate.create({ data: { ...base, scope: "CATEGORY", categoryId: w.t.guardId, effectiveTo: day("2025-12-31") } })).rejects.toThrow();
  });
});

describe("how a person is paid from a date: monthly until an approved record says hourly", () => {
  it("everyone is monthly; a proposal changes nothing until approved by someone else; then the person is hourly from that date", async () => {
    const w = await world();
    await w.on();
    const type = (iso: string) => compensationTypeFor(w.maker, w.emp.id, day(iso));
    expect(await type("2026-11-20")).toBe("MONTHLY");
    const p = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-11-16", reason: "Moves to hourly pay" });
    expect(await type("2026-11-20")).toBe("MONTHLY");
    await expect(approveCompensationType(w.maker, p.id)).rejects.toThrow(/someone else/i);
    await expect(approveCompensationType(w.t.ctx("HR_ADMIN"), p.id)).rejects.toThrow(/permission/);
    await expect(approveCompensationType(w.t.ctx("COMPANY_ADMIN", w.emp.id, 4), p.id)).rejects.toThrow(/your own/i);
    await approveCompensationType(w.checker, p.id);
    expect([await type("2026-11-15"), await type("2026-11-16"), await type("2027-02-01")]).toEqual(["MONTHLY", "HOURLY", "HOURLY"]);
    const rows = (await listCompensationTypes(w.maker)).records;
    expect(compensationTypeOn(rows.map((r) => ({ type: r.type, effectiveFrom: r.effectiveFrom, status: r.status })), day("2026-12-01"))).toBe("HOURLY");
  });

  it("a person can go back to monthly from a later date, and a record dated before the latest approved one is refused", async () => {
    const w = await world();
    await w.on();
    const one = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-03-01", reason: "Hourly from March" });
    await approveCompensationType(w.checker, one.id);
    const two = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "MONTHLY", effectiveFrom: "2026-09-01", reason: "Back to monthly" });
    await approveCompensationType(w.checker, two.id);
    expect(await compensationTypeFor(w.maker, w.emp.id, day("2026-10-01"))).toBe("MONTHLY");
    const old = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-05-01", reason: "A mistake in the dates" });
    await expect(approveCompensationType(w.checker, old.id)).rejects.toThrow(/starts on or after/i);
    expect((await db.employeeCompensationType.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("PENDING");
  });

  it("refuses a date inside a payroll period that is approved or locked, both when proposing and when approving", async () => {
    const w = await world();
    await w.on();
    const period = await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "October 2026", year: 2026, month: 10, startDate: day("2026-10-01"), endDate: day("2026-10-31"), status: "OPEN" } });
    const p = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-10-15", reason: "Moves to hourly pay" });
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await expect(approveCompensationType(w.checker, p.id)).rejects.toThrow(/Payroll for October 2026/);
    await expect(proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-10-20", reason: "Moves to hourly pay" })).rejects.toThrow(/Payroll for October 2026/);
  });

  it("another company's person is 'not found'; one pending proposal at a time; reject needs a reason; the audit log has ids and the type only", async () => {
    const a = await world();
    const b = await world();
    await a.on();
    await b.on();
    await expect(proposeCompensationType(a.maker, { employeeId: b.emp.id, type: "HOURLY", effectiveFrom: "2026-11-01", reason: "Moves to hourly pay" })).rejects.toThrow(/not found/i);
    const p = await proposeCompensationType(a.maker, { employeeId: a.emp.id, type: "HOURLY", effectiveFrom: "2026-11-01", reason: "SECRET-TYPE-REASON moves to hourly" });
    await expect(proposeCompensationType(a.maker, { employeeId: a.emp.id, type: "HOURLY", effectiveFrom: "2026-11-05", reason: "Moves to hourly pay" })).rejects.toThrow(/already a pending/i);
    await expect(approveCompensationType(b.checker, p.id)).rejects.toThrow(/not found/i);
    await expect(rejectCompensationType(a.checker, p.id, "")).rejects.toThrow(/reason/i);
    await approveCompensationType(a.checker, p.id);
    const rows = [...(await a.audit("COMPENSATION_TYPE_PROPOSED")), ...(await a.audit("COMPENSATION_TYPE_APPROVED"))];
    expect(rows).toHaveLength(2);
    expect(rows[0].newValue).toMatchObject({ employeeId: a.emp.id, type: "HOURLY", effectiveFrom: "2026-11-01" });
    expect(JSON.stringify(rows)).not.toContain("SECRET-TYPE-REASON");
  });

  it("the database keeps these records too: no delete, no change once decided", async () => {
    const w = await world();
    await w.on();
    const p = await proposeCompensationType(w.maker, { employeeId: w.emp.id, type: "HOURLY", effectiveFrom: "2026-11-01", reason: "Moves to hourly pay" });
    await approveCompensationType(w.checker, p.id);
    await expect(db.employeeCompensationType.delete({ where: { id: p.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.employeeCompensationType.update({ where: { id: p.id }, data: { type: "MONTHLY" } })).rejects.toThrow(/cannot be changed/i);
  });
});

describe("public holidays limited to states: the state of the work location decides (H11)", () => {
  it("a holiday is national until states are set; setting states, clearing them, and refusing a state that is not one", async () => {
    const w = await world();
    await w.on();
    const h = await addHoliday(w.maker, { date: "2026-11-02", name: "A Lagos holiday" });
    const national = await addHoliday(w.maker, { date: "2026-12-25", name: "Christmas Day" });
    const at = (state: string | null) => holidayDatesAt(w.maker, 2026, state);
    expect([...(await at("Kano"))].sort()).toEqual(["2026-11-02", "2026-12-25"]); // both national for now
    await setHolidayStates(w.maker, h.id, ["lagos"]);
    expect([...(await at("Lagos"))].sort()).toEqual(["2026-11-02", "2026-12-25"]);
    expect([...(await at("Kano"))]).toEqual(["2026-12-25"]);
    expect([...(await at(null))]).toEqual(["2026-12-25"]); // a place with no recognised state: national holidays only
    expect((await db.publicHolidayState.findMany({ where: { holidayId: h.id } })).map((s) => s.state)).toEqual(["Lagos"]); // stored as the proper name
    await expect(setHolidayStates(w.maker, h.id, ["Narnia"])).rejects.toThrow(/not a state/i);
    await setHolidayStates(w.maker, h.id, ["Ogun", "Abuja"]); // replaces the set; Abuja is read as FCT
    expect((await db.publicHolidayState.findMany({ where: { holidayId: h.id }, orderBy: { state: "asc" } })).map((s) => s.state)).toEqual(["FCT", "Ogun"]);
    await setHolidayStates(w.maker, h.id, []); // back to national
    expect([...(await at("Kano"))].sort()).toEqual(["2026-11-02", "2026-12-25"]);
    expect(national.id).toBeTruthy();
  });

  it("changing a holiday's states takes the year's confirmation away, so it must be confirmed again", async () => {
    const w = await world();
    await w.on();
    const h = await addHoliday(w.maker, { date: "2026-11-02", name: "A Lagos holiday" });
    await confirmHolidayYear(w.checker, 2026);
    expect(await db.holidayCalendarYear.count({ where: { organizationId: w.t.org.id, year: 2026 } })).toBe(1);
    await setHolidayStates(w.maker, h.id, ["Lagos"]);
    expect(await db.holidayCalendarYear.count({ where: { organizationId: w.t.org.id, year: 2026 } })).toBe(0);
  });

  it("needs the payroll right, and another company's holiday is 'not found'", async () => {
    const a = await world();
    const b = await world();
    await a.on();
    await b.on();
    const h = await addHoliday(a.maker, { date: "2026-11-02", name: "A holiday" });
    await expect(setHolidayStates(a.t.ctx("AUDITOR"), h.id, ["Lagos"])).rejects.toThrow(/permission/);
    await expect(setHolidayStates(b.maker, h.id, ["Lagos"])).rejects.toThrow(/not found/i);
  });

  it("removing a holiday removes its states with it; the audit entry carries the holiday's id and the states", async () => {
    const w = await world();
    await w.on();
    const h = await addHoliday(w.maker, { date: "2026-11-02", name: "A holiday" });
    await setHolidayStates(w.maker, h.id, ["Lagos", "Ogun"]);
    const rows = await w.audit("HOLIDAY_STATES_SET");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ holidayId: h.id, states: ["Lagos", "Ogun"] });
    await db.publicHoliday.delete({ where: { id: h.id } });
    expect(await db.publicHolidayState.count({ where: { holidayId: h.id } })).toBe(0);
  });
});
