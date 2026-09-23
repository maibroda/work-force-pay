import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { iso } from "@/lib/dates";
import { createEmployee, updateEmployee, type EmployeeInput } from "@/server/services/employees";
import {
  addDocument,
  addTraining,
  approveDisciplinary,
  approveExit,
  completeExitTask,
  completeOnboardingTask,
  EXIT_CLEARANCE_TASKS,
  initiateExit,
  ONBOARDING_TASKS,
  orgChart,
  raiseDisciplinary,
  revokeTraining,
  type OrgNode,
} from "@/server/services/hr";
import { documentsReport, trainingReport } from "@/server/services/reports";
import { ctxFor, uid } from "../helpers";

function toInput(e: { firstName: string; lastName: string; employmentDate: Date; categoryId: string }) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    employmentDate: iso(e.employmentDate),
    categoryId: e.categoryId,
  } satisfies EmployeeInput;
}

async function newEmployee(name: string) {
  const hr = await ctxFor("HR_ADMIN");
  const cat = await db.employeeCategory.findFirstOrThrow({
    where: { organizationId: hr.orgId, code: "GUARD" },
  });
  return createEmployee(hr, {
    firstName: name,
    lastName: `HR${uid()}`,
    employmentDate: "2027-01-01",
    categoryId: cat.id,
  });
}

describe("onboarding checklist", () => {
  it("is seeded automatically on hire, and can be checked off", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const emp = await newEmployee("Onboard");
    const tasks = await db.onboardingTask.findMany({ where: { employeeId: emp.id } });
    expect(tasks).toHaveLength(ONBOARDING_TASKS.length);
    expect(tasks.every((t) => t.status === "PENDING")).toBe(true);

    const updated = await completeOnboardingTask(hr, tasks[0].id);
    expect(updated.status).toBe("DONE");
    expect(updated.completedBy).toBe(hr.name);
    expect(updated.completedAt).toBeTruthy();
  });
});

describe("employee documents & training", () => {
  it("records a document with expiry, and only hr.manage can add one", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const auditor = await ctxFor("AUDITOR");
    const emp = await newEmployee("Docs");

    await expect(
      addDocument(auditor, {
        employeeId: emp.id,
        documentType: "GUARD_LICENSE",
        fileReference: "scan.pdf",
      }),
    ).rejects.toThrow();

    const doc = await addDocument(hr, {
      employeeId: emp.id,
      documentType: "GUARD_LICENSE",
      documentNumber: "GL-001",
      issueDate: "2026-01-01",
      expiryDate: "2026-06-01", // already expired relative to "today" in the seed's fixed clock
      fileReference: "scan-gl-001.pdf",
    });
    expect(doc.documentType).toBe("GUARD_LICENSE");

    const report = await documentsReport(hr);
    const row = report.find((r) => r.fileReference === "scan-gl-001.pdf")!;
    expect(row.status).toBe("EXPIRED");
  });

  it("records training/certifications and can revoke one", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const emp = await newEmployee("Train");
    const t = await addTraining(hr, {
      employeeId: emp.id,
      courseName: "Firearms Handling",
      issueDate: "2026-01-01",
      expiryDate: "2028-01-01",
    });
    expect(t.status).toBe("VALID");

    const revoked = await revokeTraining(hr, t.id, "Failed re-certification");
    expect(revoked.status).toBe("REVOKED");

    const report = await trainingReport(hr);
    const row = report.find((r) => r.courseName === "Firearms Handling")!;
    expect(row.status).toBe("REVOKED");
  });
});

describe("disciplinary records — maker/checker", () => {
  it("is raised PENDING and requires hr.approve to sign off", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const emp = await newEmployee("Conduct");

    await expect(
      raiseDisciplinary(ops, {
        employeeId: emp.id,
        type: "QUERY",
        incidentDate: "2027-01-05",
        description: "Late to post",
      }),
    ).rejects.toThrow();

    const rec = await raiseDisciplinary(hr, {
      employeeId: emp.id,
      type: "WRITTEN_WARNING",
      incidentDate: "2027-01-05",
      description: "Slept on duty",
      actionTaken: "Written warning issued",
    });
    expect(rec.status).toBe("PENDING");

    await expect(approveDisciplinary(ops, rec.id)).rejects.toThrow();

    const approved = await approveDisciplinary(hr, rec.id, "Confirmed with supervisor");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe(hr.name);

    await expect(approveDisciplinary(hr, rec.id)).rejects.toThrow(/Already decided/);
  });
});

describe("exit / offboarding", () => {
  it("initiating then approving an exit updates employee status and seeds the clearance checklist", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const emp = await newEmployee("Leaver");

    const exit = await initiateExit(hr, {
      employeeId: emp.id,
      exitType: "RESIGNATION",
      noticeDate: "2027-02-01",
      lastWorkingDate: "2027-02-28",
      reason: "Relocating",
    });
    expect(exit.status).toBe("PENDING");

    // can't initiate a second exit while one is pending
    await expect(
      initiateExit(hr, {
        employeeId: emp.id,
        exitType: "TERMINATION",
        noticeDate: "2027-02-01",
        lastWorkingDate: "2027-02-15",
        reason: "Duplicate",
      }),
    ).rejects.toThrow(/already pending/);

    await approveExit(hr, exit.id);
    const updatedEmp = await db.employee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(updatedEmp.status).toBe("RESIGNED");
    expect(updatedEmp.exitDate?.toISOString().slice(0, 10)).toBe("2027-02-28");

    const tasks = await db.exitTask.findMany({ where: { exitRecordId: exit.id } });
    expect(tasks).toHaveLength(EXIT_CLEARANCE_TASKS.length);
    expect(tasks.every((t) => t.status === "PENDING")).toBe(true);

    const done = await completeExitTask(hr, tasks[0].id);
    expect(done.status).toBe("DONE");
  });
});

describe("org chart", () => {
  it("nests employees under their reporting manager", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const manager = await newEmployee("Manager");
    const report = await newEmployee("Report");
    await updateEmployee(
      hr,
      report.id,
      { ...toInput(report), reportingManagerId: manager.id },
      "Org chart test",
    );

    await expect(
      updateEmployee(hr, manager.id, { ...toInput(manager), reportingManagerId: manager.id }),
    ).rejects.toThrow(/cannot report to themselves/);

    const { tree } = await orgChart(hr);
    const managerNode = findNode(tree, manager.id);
    expect(managerNode).toBeTruthy();
    expect(managerNode!.children.some((c) => c.id === report.id)).toBe(true);
  });
});

function findNode(tree: OrgNode[], id: string): OrgNode | undefined {
  for (const n of tree) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return undefined;
}
