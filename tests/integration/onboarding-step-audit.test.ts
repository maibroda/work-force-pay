import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { addOnboardingTask, completeOnboardingTask } from "@/server/services/hr";
import { isolatedOrg } from "../helpers";

// Follow-up to #219 to #230 (the last of the audit-log scan's findings): adding or completing an onboarding step is recorded by the step's id, status and due day, never its name (HR types it freely, so it
// can hold anything) or any note on it. The step itself still holds them. The audit log is append-only and cannot be reached when a person is erased.

const SECRET = "SECRET-STEP collect the guarantor's signed letter from Mrs Adaeze";

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Obinna", lastName: "Starter", employmentDate: "2026-11-02", categoryId: t.guardId } as never);
  const log = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: emp.id, action } });
  return { t, hr, emp, log };
}

describe("the audit log and an onboarding step's words", () => {
  it("adding a step is recorded by its id, status and due day, never its name", async () => {
    const w = await world();
    const due = iso(addDays(todayUtc(), 7));
    const task = await addOnboardingTask(w.hr, w.emp.id, SECRET, due);
    const rows = await w.log("ONBOARDING_TASK_ADD");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ taskId: task.id, status: "PENDING", dueDate: due });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-STEP|guarantor|Adaeze/);
  });

  it("adding a step with no due day carries none", async () => {
    const w = await world();
    const task = await addOnboardingTask(w.hr, w.emp.id, SECRET);
    const row = (await w.log("ONBOARDING_TASK_ADD"))[0];
    expect(row.newValue).toEqual({ taskId: task.id, status: "PENDING" });
  });

  it("completing a step is recorded by its id and status, never its name or any note on it", async () => {
    const w = await world();
    const task = await addOnboardingTask(w.hr, w.emp.id, SECRET);
    await db.onboardingTask.update({ where: { id: task.id }, data: { notes: "SECRET-NOTE seen at the office" } });
    await completeOnboardingTask(w.hr, task.id);
    const rows = await w.log("ONBOARDING_TASK_COMPLETE");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toEqual({ taskId: task.id, status: "DONE" });
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-STEP|SECRET-NOTE|guarantor|Adaeze/);
  });

  it("the step itself still holds its name and its note, for those with HR access", async () => {
    const w = await world();
    const task = await addOnboardingTask(w.hr, w.emp.id, SECRET);
    await db.onboardingTask.update({ where: { id: task.id }, data: { notes: "SECRET-NOTE seen at the office" } });
    const stored = await db.onboardingTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.taskName).toContain("SECRET-STEP");
    expect(stored.notes).toContain("SECRET-NOTE");
  });
});
