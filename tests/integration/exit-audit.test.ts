import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import {
  addOnboardingTask,
  approveExit,
  completeExitTask,
  initiateExit,
  markTaskNotApplicable,
  recordExitInterview,
  rejectExit,
} from "@/server/services/hr";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #226 (the founder chose "go ahead with the exit entries" on 2026-11-18): the audit log carries an exit's id, type, status, dates and the rehire flag, and a checklist step's id and
// status, never the reason, the remarks, the exit-interview notes or the reason a step was waived. Those words are HR records, read by those with HR access; the audit log, which the administrators and
// the auditor read, must not show the same words. It is append-only and cannot be reached when a person is erased. The records themselves still hold everything.

const SECRETS = ["SECRET-REASON", "SECRET-REMARKS", "SECRET-NOTES", "SECRET-WAIVE", "SECRET-REJECT"];
const lastDay = () => iso(addDays(todayUtc(), 20));

async function world() {
  const t = await isolatedOrg();
  const hr1 = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const emp = await createEmployee(hr1, { firstName: "Tunde", lastName: "Leaver", employmentDate: "2023-01-05", categoryId: t.guardId } as never);
  const start = (over: Record<string, unknown> = {}) =>
    initiateExit(hr1, { employeeId: emp.id, exitType: "TERMINATION", noticeDate: iso(todayUtc()), lastWorkingDate: lastDay(), reason: "SECRET-REASON repeated absence and a client complaint", reasonCategory: "PERFORMANCE", ...over } as never);
  const log = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  const noWords = (rows: unknown) => {
    const text = JSON.stringify(rows);
    for (const s of SECRETS) expect(text, s).not.toContain(s);
    expect(text).not.toMatch(/repeated absence|client complaint|signed off|never issued|family reasons/i);
  };
  return { t, hr1, hr2, emp, start, log, noWords };
}

describe("the audit log and an exit's words", () => {
  it("starting an exit is recorded by its id, type, status and dates, never the reason", async () => {
    const w = await world();
    const rec = await w.start();
    const rows = await w.log("EXIT_INITIATE");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "Employee", entityId: w.emp.id });
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, exitType: "TERMINATION", status: "PENDING", lastWorkingDate: lastDay(), summaryDismissal: false });
    w.noWords(rows);
  });

  it("approving an exit is recorded as approved, never the remarks or the reason", async () => {
    const w = await world();
    const rec = await w.start();
    await approveExit(w.hr2, rec.id, "SECRET-REMARKS signed off after the hearing");
    const rows = await w.log("EXIT_APPROVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, exitType: "TERMINATION", status: "APPROVED" });
    w.noWords(rows);
  });

  it("rejecting an exit is recorded as rejected, never the remarks or the reason", async () => {
    const w = await world();
    const rec = await w.start();
    await rejectExit(w.hr2, rec.id, "SECRET-REJECT the evidence does not support it");
    const rows = await w.log("EXIT_REJECT");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, status: "REJECTED" });
    w.noWords(rows);
  });

  it("the exit interview is recorded with its date and the rehire flag, never the notes", async () => {
    const w = await world();
    const rec = await w.start();
    await approveExit(w.hr2, rec.id);
    await recordExitInterview(w.hr1, { exitRecordId: rec.id, interviewDate: iso(todayUtc()), notes: "SECRET-NOTES left for family reasons and would not return", eligibleForRehire: false });
    const rows = await w.log("EXIT_INTERVIEW_RECORD");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ recordId: rec.id, eligibleForRehire: false, exitInterviewDate: iso(todayUtc()) });
    w.noWords(rows);
  });

  it("waiving a clearance step is recorded by the step's id and status, never the reason", async () => {
    const w = await world();
    const rec = await w.start();
    await approveExit(w.hr2, rec.id);
    const task = await db.exitTask.findFirstOrThrow({ where: { exitRecordId: rec.id, status: "PENDING", documentTypeId: null } });
    await markTaskNotApplicable(w.hr1, "exit", task.id, "SECRET-WAIVE never issued a uniform");
    const rows = await w.log("EXIT_TASK_WAIVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ taskId: task.id, exitRecordId: rec.id, status: "NOT_APPLICABLE" });
    expect(rows[0].reason).toBeNull();
    w.noWords(rows);
  });

  it("waiving an onboarding step is recorded the same way, never the reason", async () => {
    const w = await world();
    const task = await addOnboardingTask(w.hr1, w.emp.id, "Collect a passport photograph");
    await markTaskNotApplicable(w.hr1, "onboarding", task.id, "SECRET-WAIVE already on file from a previous job");
    const rows = await w.log("ONBOARDING_TASK_WAIVE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ taskId: task.id, status: "NOT_APPLICABLE" });
    expect(rows[0].reason).toBeNull();
    w.noWords(rows);
  });

  it("completing a clearance step is recorded by the step's id and status", async () => {
    const w = await world();
    const rec = await w.start();
    await approveExit(w.hr2, rec.id);
    const task = await db.exitTask.findFirstOrThrow({ where: { exitRecordId: rec.id, status: "PENDING", documentTypeId: null } });
    await completeExitTask(w.hr1, task.id);
    const rows = await w.log("EXIT_TASK_COMPLETE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ taskId: task.id, exitRecordId: rec.id, status: "DONE" });
  });

  it("the records themselves still hold the reason, the remarks, the interview notes and the waiver reason, for those with HR access", async () => {
    const w = await world();
    const rec = await w.start();
    await approveExit(w.hr2, rec.id, "SECRET-REMARKS signed off after the hearing");
    await recordExitInterview(w.hr1, { exitRecordId: rec.id, interviewDate: iso(todayUtc()), notes: "SECRET-NOTES left for family reasons", eligibleForRehire: true });
    const task = await db.exitTask.findFirstOrThrow({ where: { exitRecordId: rec.id, status: "PENDING", documentTypeId: null } });
    await markTaskNotApplicable(w.hr1, "exit", task.id, "SECRET-WAIVE never issued a uniform");
    const stored = await db.exitRecord.findUniqueOrThrow({ where: { id: rec.id } });
    expect(stored.reason).toContain("SECRET-REASON");
    expect(stored.remarks).toContain("SECRET-REMARKS");
    expect(stored.exitInterviewNotes).toContain("SECRET-NOTES");
    expect((await db.exitTask.findUniqueOrThrow({ where: { id: task.id } })).notes).toContain("SECRET-WAIVE");
  });
});
