import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { approveTimeEntry, captureTimeEntry, correctTimeEntry, rejectTimeEntry, submitTimeEntry } from "@/server/services/time-entries";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay: erasing a person clears the words typed on their shifts (the founder said go, 2026-11-20; the follow-up to the data copy of #242). The database protects every time entry from any change, so it allows exactly
 * one kind of change to a decided entry: clearing its two free-text fields (the reason for a correction and the note on a rejection) to nothing. Everything else about the entry, including its times, status and approved
 * hours, stays, because those are the facts a pay record needs. Another person's entries are never touched.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

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
  const approved = async (employeeId: string, from: string, to: string) => {
    const e = await captureTimeEntry(ops, { employeeId, beatId: beat.id, clockIn: from, clockOut: to });
    await submitTimeEntry(ops, e.id);
    return approveTimeEntry(sup, e.id, {});
  };
  /** an entry with words on it in each state: a rejected one (a note), an approved correction (a reason), and a superseded correction (a reason, replaced by a second correction) */
  const withWords = async (employeeId: string, tag: string, firstDay: string) => {
    const rejected = await captureTimeEntry(ops, { employeeId, beatId: beat.id, clockIn: `${firstDay}T08:00`, clockOut: `${firstDay}T16:00` });
    await submitTimeEntry(ops, rejected.id);
    await rejectTimeEntry(sup, rejected.id, `SECRET-NOTE-${tag} suspected padding of hours`);
    const nextDay = (n: number) => `2026-11-${String(Number(firstDay.slice(8)) + n).padStart(2, "0")}`;
    const original = await approved(employeeId, `${nextDay(1)}T08:00`, `${nextDay(1)}T16:00`);
    const c1 = await correctTimeEntry(ops, original.id, { clockIn: `${nextDay(1)}T08:00`, clockOut: `${nextDay(1)}T15:00`, reason: `SECRET-REASON-${tag}-ONE left an hour early` });
    await submitTimeEntry(ops, c1.id);
    await approveTimeEntry(sup, c1.id, {});
    const c2 = await correctTimeEntry(ops, c1.id, { clockIn: `${nextDay(1)}T08:00`, clockOut: `${nextDay(1)}T14:00`, reason: `SECRET-REASON-${tag}-TWO left two hours early` });
    await submitTimeEntry(ops, c2.id);
    await approveTimeEntry(sup, c2.id, {});
    return { rejected, original, c1, c2 };
  };
  return { t, sup, ops, hr, beat, hourly, approved, withWords };
}

describe("the database allows one change to a decided time entry: clearing its words", () => {
  it("clearing the note on a rejected entry and the reason on an approved or a replaced correction is allowed", async () => {
    const w = await world();
    const e = await w.hourly("One");
    const x = await w.withWords(e.id, "A", "2026-11-02");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: x.rejected.id } })).status).toBe("REJECTED");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: x.c1.id } })).status).toBe("SUPERSEDED");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: x.c2.id } })).status).toBe("APPROVED");
    const row = (id: string) => db.timeEntry.findUniqueOrThrow({ where: { id } });
    await db.timeEntry.update({ where: { id: x.rejected.id }, data: { decisionNote: null } });
    expect((await row(x.rejected.id)).decisionNote).toBeNull();
    await db.timeEntry.update({ where: { id: x.c1.id }, data: { reason: null } });
    expect((await row(x.c1.id)).reason).toBeNull();
    await db.timeEntry.update({ where: { id: x.c2.id }, data: { reason: null } });
    expect((await row(x.c2.id)).reason).toBeNull();
    expect((await row(x.c2.id)).status).toBe("APPROVED"); // only the words went
  });

  it("but never changing the words to other words, never clearing them together with any other change, and never deleting the entry", async () => {
    const w = await world();
    const e = await w.hourly("One");
    const x = await w.withWords(e.id, "A", "2026-11-02");
    await expect(db.timeEntry.update({ where: { id: x.c2.id }, data: { reason: "A different reason" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: x.rejected.id }, data: { decisionNote: "A different note" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: x.c2.id }, data: { reason: null, payableMinutes: 1 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: x.c2.id }, data: { reason: null, clockIn: new Date("2026-11-03T06:00:00Z") } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: x.rejected.id }, data: { decisionNote: null, status: "DRAFT" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.delete({ where: { id: x.c2.id } })).rejects.toThrow(/cannot be deleted/i);
    // nothing was cleared by the refused attempts
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: x.c2.id } })).reason).toContain("SECRET-REASON-A-TWO");
  });

  it("the ordinary flow still works: a note is written when an entry is rejected, a reason when a correction is started", async () => {
    const w = await world();
    const e = await w.hourly("One");
    const entry = await captureTimeEntry(w.ops, { employeeId: e.id, beatId: w.beat.id, clockIn: "2026-11-02T08:00", clockOut: "2026-11-02T16:00" });
    await submitTimeEntry(w.ops, entry.id);
    await expect(rejectTimeEntry(w.sup, entry.id, "Wrong site, please recapture")).resolves.toMatchObject({ status: "REJECTED", decisionNote: "Wrong site, please recapture" });
  });
});

describe("erasing a person clears the words on their shifts and keeps the facts", () => {
  it("clears every note and reason on the person's entries, keeps their times, status and approved hours, and leaves a colleague's words alone", async () => {
    const w = await world();
    const a = await w.hourly("Erased");
    const b = await w.hourly("Colleague");
    const xa = await w.withWords(a.id, "A", "2026-11-02");
    const xb = await w.withWords(b.id, "B", "2026-11-02");
    const before = await db.timeEntry.findMany({ where: { employeeId: a.id }, orderBy: [{ clockIn: "asc" }, { id: "asc" }] });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, a.id, new Date("2026-12-01T00:00:00Z")));
    expect(counts.timeEntries).toBe(before.filter((r) => r.reason !== null || r.decisionNote !== null).length); // only the entries that had words
    const after = await db.timeEntry.findMany({ where: { employeeId: a.id }, orderBy: [{ clockIn: "asc" }, { id: "asc" }] });
    expect(after.map((r) => [r.reason, r.decisionNote])).toEqual(after.map(() => [null, null]));
    // the facts stay: times, status, the approved hours, who approved (three entries start at the same minute, so both lists are put in a fixed order: by start time, then by id)
    expect(after.map((r) => [r.id, r.clockIn.getTime(), r.clockOut?.getTime() ?? null, r.status, r.payableMinutes, r.decidedByUserId])).toEqual(before.map((r) => [r.id, r.clockIn.getTime(), r.clockOut?.getTime() ?? null, r.status, r.payableMinutes, r.decidedByUserId]));
    expect(await db.timeEntrySegment.count({ where: { entryId: { in: [xa.original.id, xa.c1.id, xa.c2.id] } } })).toBe(3);
    // the colleague's words are untouched
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: xb.rejected.id } })).decisionNote).toContain("SECRET-NOTE-B");
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: xb.c2.id } })).reason).toContain("SECRET-REASON-B-TWO");
  });

  it("no word typed on the erased person's shifts is left anywhere in their entries, whatever state the entry is in", async () => {
    const w = await world();
    const a = await w.hourly("Erased");
    await w.withWords(a.id, "A", "2026-11-02");
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, a.id, new Date("2026-12-01T00:00:00Z")));
    const text = JSON.stringify(await db.timeEntry.findMany({ where: { employeeId: a.id } }));
    expect(text).not.toContain("SECRET-");
  });

  it("a person with no shifts is erased as before (nothing to clear)", async () => {
    const w = await world();
    const a = await w.hourly("NoShifts");
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, a.id, new Date("2026-12-01T00:00:00Z")));
    expect(counts.timeEntries).toBe(0);
  });
});
