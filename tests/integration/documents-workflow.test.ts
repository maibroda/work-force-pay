import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { STANDARD_STEP_LINKS, taskStateFromDocument } from "@/lib/documents";
import {
  approveDocument,
  archiveDocument,
  linkStandardSteps,
  listEmployeeDocuments,
  listTypes,
  rejectDocument,
  replaceDocument,
  startReview,
  submitDocument,
  updateType,
  uploadDocument,
} from "@/server/services/documents";
import { approveExit, completeExitTask, completeOnboardingTask, initiateExit, markTaskNotApplicable } from "@/server/services/hr";
import { listChecklistTemplates, updateTemplateItem } from "@/server/services/hr-policy";
import { isolatedOrg } from "../helpers";

// Electronic employee documents, part B: the approval workflow and the onboarding and exit links
// (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md). Synthetic files only.

const pdf = (label = "one") => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(`synthetic ${label}`)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic image")]);

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
  const hr = t.ctx("HR_ADMIN"); // uploads
  const reviewer = t.ctx("HR_ADMIN", null, 2); // a second person
  const boss = t.ctx("COMPANY_ADMIN");
  const types = await listTypes(hr);
  const type = (code: string) => types.find((x) => x.code === code)!;
  const hire = (name: string) => createEmployee(hr, { firstName: name, lastName: "Hire", employmentDate: "2026-01-05", categoryId: t.guardId });
  const emp = await hire("First");
  return { t, hr, reviewer, boss, type, hire, emp };
}
type World = Awaited<ReturnType<typeof world>>;

const upload = (w: World, code = "OFFER_LETTER", name = "Offer.pdf") =>
  uploadDocument(w.hr, { employeeId: w.emp.id, typeId: w.type(code).id, file: { name, bytes: pdf(name) } } as never);
const row = (id: string) => db.employeeDocument.findUniqueOrThrow({ where: { id } });

describe("the approval workflow", () => {
  it("a new upload is pending; submitting it for review is a separate step", async () => {
    const w = await world();
    const r = await upload(w);
    expect((await row(r.document.id)).status).toBe("PENDING");
    const s = await submitDocument(w.hr, r.document.id);
    expect(s).toMatchObject({ status: "SUBMITTED", submittedBy: w.hr.name, submittedByUserId: w.hr.userId });
    expect(s.submittedAt).toBeInstanceOf(Date);
    await expect(submitDocument(w.hr, r.document.id)).rejects.toThrow(/pending/i);
    await expect(submitDocument(w.t.ctx("AUDITOR"), r.document.id)).rejects.toThrow(/permission/);
  });

  it("a type that needs no approval is not submitted for one", async () => {
    const w = await world();
    await updateType(w.hr, w.type("TRAINING_CERTIFICATE").id, { requiresApproval: false });
    const r = await upload(w, "TRAINING_CERTIFICATE", "t.pdf");
    expect((await row(r.document.id)).status).toBe("APPROVED");
    await expect(submitDocument(w.hr, r.document.id)).rejects.toThrow(/does not need approval/i);
  });

  it("a reviewer takes it, then approves it: the reviewer and the date are recorded, never the uploader", async () => {
    const w = await world();
    const r = await upload(w);
    await submitDocument(w.hr, r.document.id);
    await expect(startReview(w.hr, r.document.id)).rejects.toThrow(/someone else/i); // the uploader
    await expect(approveDocument(w.hr, r.document.id)).rejects.toThrow(/someone else/i);
    const taken = await startReview(w.reviewer, r.document.id);
    expect(taken).toMatchObject({ status: "UNDER_REVIEW", reviewedBy: w.reviewer.name, reviewedByUserId: w.reviewer.userId });
    expect(taken.reviewStartedAt).toBeInstanceOf(Date);
    await expect(approveDocument(w.boss, r.document.id)).rejects.toThrow(/another reviewer/i);
    const done = await approveDocument(w.reviewer, r.document.id, "Checked against the original");
    expect(done).toMatchObject({ status: "APPROVED", reviewedBy: w.reviewer.name, reviewNote: "Checked against the original" });
    expect(done.reviewedAt).toBeInstanceOf(Date);
    expect((await listEmployeeDocuments(w.hr, w.emp.id))[0]).toMatchObject({ status: "APPROVED", reviewedBy: w.reviewer.name });
  });

  it("someone other than the uploader who submitted it cannot review it either; a third person can, straight from submitted", async () => {
    const w = await world();
    const r = await upload(w);
    await submitDocument(w.reviewer, r.document.id); // submitted by the second person
    await expect(startReview(w.reviewer, r.document.id)).rejects.toThrow(/someone else/i);
    await expect(approveDocument(w.reviewer, r.document.id)).rejects.toThrow(/someone else/i);
    await expect(approveDocument(w.boss, r.document.id)).resolves.toMatchObject({ status: "APPROVED", reviewedBy: w.boss.name });
  });

  it("a rejection needs a reason, is recorded, and a replacement puts the document back to pending to be submitted again", async () => {
    const w = await world();
    const r = await upload(w);
    await submitDocument(w.hr, r.document.id);
    await expect(rejectDocument(w.reviewer, r.document.id, "")).rejects.toThrow(/why/i);
    await expect(rejectDocument(w.reviewer, r.document.id, "no")).rejects.toThrow(/why/i);
    const rej = await rejectDocument(w.reviewer, r.document.id, "The scan is cut off at the bottom");
    expect(rej).toMatchObject({ status: "REJECTED", reviewNote: "The scan is cut off at the bottom", reviewedBy: w.reviewer.name });
    expect(rej.reviewedAt).toBeInstanceOf(Date);
    await expect(approveDocument(w.reviewer, r.document.id)).rejects.toThrow(/submitted/i);
    await replaceDocument(w.hr, r.document.id, { file: { name: "Offer v2.pdf", bytes: pdf("v2") } });
    expect(await row(r.document.id)).toMatchObject({ status: "PENDING", submittedAt: null, reviewedBy: null, reviewedAt: null, reviewNote: null });
    await expect(submitDocument(w.hr, r.document.id)).resolves.toMatchObject({ status: "SUBMITTED" });
  });

  it("only someone who may approve reviews, approves or rejects", async () => {
    const w = await world();
    const r = await upload(w);
    await submitDocument(w.hr, r.document.id);
    for (const role of ["AUDITOR", "FINANCE", "OPERATIONS"] as const) {
      await expect(startReview(w.t.ctx(role), r.document.id), role).rejects.toThrow(/permission/);
      await expect(approveDocument(w.t.ctx(role), r.document.id), role).rejects.toThrow(/permission/);
      await expect(rejectDocument(w.t.ctx(role), r.document.id, "Not allowed to say so"), role).rejects.toThrow(/permission/);
    }
  });

  it("only a submitted document can be reviewed, and an archived one cannot be submitted", async () => {
    const w = await world();
    const r = await upload(w);
    await expect(approveDocument(w.reviewer, r.document.id)).rejects.toThrow(/submitted/i);
    await expect(startReview(w.reviewer, r.document.id)).rejects.toThrow(/submitted/i);
    await archiveDocument(w.hr, r.document.id);
    await expect(submitDocument(w.hr, r.document.id)).rejects.toThrow(/archived|pending/i);
  });

  it("an identification document is reviewed only by someone with sensitive access, and another company's is not found", async () => {
    const w = await world();
    const r = await uploadDocument(w.hr, { employeeId: w.emp.id, typeId: w.type("NATIONAL_ID").id, file: { name: "id.png", bytes: png } } as never);
    await submitDocument(w.hr, r.document.id);
    const other = await isolatedOrg();
    await expect(approveDocument(other.ctx("HR_ADMIN"), r.document.id)).rejects.toThrow(/not found/i);
    without("HR_ADMIN", "document.sensitive");
    await expect(approveDocument(w.reviewer, r.document.id)).rejects.toThrow(/not found/i);
  });

  it("every step is audited by ids, with the rejection reason, and never the file name", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER", "Private name.pdf");
    await submitDocument(w.hr, r.document.id);
    await startReview(w.reviewer, r.document.id);
    await rejectDocument(w.reviewer, r.document.id, "Signature is missing");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: r.document.id } });
    expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(["DOCUMENT_UPLOAD", "DOCUMENT_SUBMIT", "DOCUMENT_REVIEW_START", "DOCUMENT_REJECT"]));
    expect(rows.find((x) => x.action === "DOCUMENT_REJECT")!.reason).toBe("Signature is missing");
    expect(JSON.stringify(rows)).not.toContain("Private name");
  });
});

describe("linking the standard checklist steps to document types", () => {
  it("links the clear matches once, never the broad steps, and never overrides a step already linked by hand", async () => {
    const w = await world();
    const first = await linkStandardSteps(w.hr);
    expect(first).toEqual({ onboarding: Object.keys(STANDARD_STEP_LINKS.ONBOARDING).length, exit: Object.keys(STANDARD_STEP_LINKS.EXIT_CLEARANCE).length });
    const onboarding = await listChecklistTemplates(w.hr, "ONBOARDING");
    const step = (name: string) => onboarding.find((x) => x.taskName === name)!;
    expect(step("Offer letter signed").documentTypeId).toBe(w.type("OFFER_LETTER").id);
    expect(step("Documents collected (ID, certificates, references)").documentTypeId).toBeNull();
    expect(step("ID card issued").documentTypeId).toBeNull();
    expect(await linkStandardSteps(w.hr)).toEqual({ onboarding: 0, exit: 0 }); // asking again changes nothing
    await updateTemplateItem(w.hr, step("Offer letter signed").id, { documentTypeId: w.type("APPOINTMENT_LETTER").id });
    await linkStandardSteps(w.hr);
    expect((await listChecklistTemplates(w.hr, "ONBOARDING")).find((x) => x.taskName === "Offer letter signed")!.documentTypeId).toBe(w.type("APPOINTMENT_LETTER").id);
  });

  it("is for those who may configure checklists and document types, and a step can only name this company's types", async () => {
    const w = await world();
    for (const role of ["AUDITOR", "FINANCE", "OPERATIONS"] as const) await expect(linkStandardSteps(w.t.ctx(role)), role).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    const foreign = (await listTypes(other.ctx("HR_ADMIN")))[0];
    const item = (await listChecklistTemplates(w.hr, "ONBOARDING"))[0];
    await expect(updateTemplateItem(w.hr, item.id, { documentTypeId: foreign.id })).rejects.toThrow(/type not found/i);
  });

  it("only steps made after the linking follow a document: tasks that already exist are not changed", async () => {
    const w = await world(); // the first hire was made before any linking
    await linkStandardSteps(w.hr);
    const before = await db.onboardingTask.findMany({ where: { employeeId: w.emp.id } });
    expect(before.every((x) => x.documentTypeId === null)).toBe(true);
    const later = await w.hire("Later");
    const offer = await db.onboardingTask.findFirstOrThrow({ where: { employeeId: later.id, taskName: "Offer letter signed" } });
    expect(offer.documentTypeId).toBe(w.type("OFFER_LETTER").id);
  });
});

describe("an onboarding step follows its document", () => {
  async function linked() {
    const w = await world();
    await linkStandardSteps(w.hr);
    const hire = await w.hire("Linked");
    const task = (name: string) => db.onboardingTask.findFirstOrThrow({ where: { employeeId: hire.id, taskName: name }, include: { document: true } });
    const state = async (name: string) => {
      const t = await task(name);
      return taskStateFromDocument(t.document?.status);
    };
    const uploadFor = async (name: string, over: Record<string, unknown> = {}) => {
      const t = await task(name);
      return uploadDocument(w.hr, { employeeId: hire.id, task: { kind: "ONBOARDING", id: t.id }, file: { name: "Offer.pdf", bytes: pdf("for the task") }, ...over } as never);
    };
    return { w, hire, task, state, uploadFor };
  }

  it("shows Pending, then Submitted, Under review, and Completed only when the document is approved", async () => {
    const { w, state, task, uploadFor } = await linked();
    const name = "Offer letter signed";
    expect(await state(name)).toBe("PENDING"); // no document yet
    const r = await uploadFor(name);
    expect(r.document.typeId).toBe(w.type("OFFER_LETTER").id); // the type comes from the step
    expect((await task(name)).documentId).toBe(r.document.id);
    expect(await state(name)).toBe("PENDING"); // uploaded, not yet submitted
    await submitDocument(w.hr, r.document.id);
    expect(await state(name)).toBe("SUBMITTED");
    await startReview(w.reviewer, r.document.id);
    expect(await state(name)).toBe("UNDER_REVIEW");
    expect((await task(name)).status).toBe("PENDING");
    await approveDocument(w.reviewer, r.document.id);
    expect(await state(name)).toBe("COMPLETED");
    const done = await task(name);
    expect(done.status).toBe("DONE");
    expect(done.completedBy).toMatch(/document approved/i);
    expect(done.completedBy).toContain(w.reviewer.name);
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it("a rejection leaves the step pending with the reason, and replacing an approved document reopens it", async () => {
    const { w, task, uploadFor } = await linked();
    const name = "Employment contract signed & filed";
    const r = await uploadFor(name, { file: { name: "Contract.pdf", bytes: pdf("contract") } });
    await submitDocument(w.hr, r.document.id);
    await rejectDocument(w.reviewer, r.document.id, "Page 3 is missing");
    expect(await task(name)).toMatchObject({ status: "PENDING" });
    expect((await task(name)).notes).toMatch(/rejected: page 3 is missing/i);
    await replaceDocument(w.hr, r.document.id, { file: { name: "Contract v2.pdf", bytes: pdf("v2") } });
    await submitDocument(w.hr, r.document.id);
    await approveDocument(w.reviewer, r.document.id);
    expect((await task(name)).status).toBe("DONE");
    await replaceDocument(w.hr, r.document.id, { file: { name: "Contract v3.pdf", bytes: pdf("v3") } }); // a changed document must be approved again
    expect(await task(name)).toMatchObject({ status: "PENDING", completedBy: null, completedAt: null });
  });

  it("cannot be ticked off by hand; not applicable (with a reason) still works and is not undone by the document", async () => {
    const { w, task, uploadFor } = await linked();
    const name = "Medical examination";
    const t = await task(name);
    await expect(completeOnboardingTask(w.hr, t.id)).rejects.toThrow(/completed by its document/i);
    await markTaskNotApplicable(w.hr, "onboarding", t.id, "Not needed for this role");
    expect((await task(name)).status).toBe("NOT_APPLICABLE");
    const r = await uploadFor(name, { file: { name: "Medical.pdf", bytes: pdf("medical") } });
    await submitDocument(w.hr, r.document.id);
    await approveDocument(w.reviewer, r.document.id);
    expect((await task(name)).status).toBe("NOT_APPLICABLE");
  });

  it("a step with no document is completed by hand, as before", async () => {
    const { w, task } = await linked();
    const t = await task("ID card issued");
    expect(t.documentTypeId).toBeNull();
    await expect(completeOnboardingTask(w.hr, t.id)).resolves.toMatchObject({ status: "DONE", completedBy: w.hr.name });
  });

  it("a type that needs no approval completes the step on upload, and says so", async () => {
    const { w, task, uploadFor } = await linked();
    await updateType(w.hr, w.type("OFFER_LETTER").id, { requiresApproval: false });
    const r = await uploadFor("Offer letter signed");
    expect(r.document.status).toBe("APPROVED");
    const done = await task("Offer letter signed");
    expect(done.status).toBe("DONE");
    expect(done.completedBy).toMatch(/no approval required/i);
  });

  it("refuses an upload for a step of another company, another employee, a step with no document type, or without sensitive access", async () => {
    const { w, hire, task, uploadFor } = await linked();
    const t = await task("Offer letter signed");
    const other = await isolatedOrg();
    await expect(uploadDocument(other.ctx("HR_ADMIN"), { employeeId: hire.id, task: { kind: "ONBOARDING", id: t.id }, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/not found/i);
    await expect(uploadDocument(w.hr, { employeeId: w.emp.id, task: { kind: "ONBOARDING", id: t.id }, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/not found|does not belong/i);
    const plain = await task("ID card issued");
    await expect(uploadDocument(w.hr, { employeeId: hire.id, task: { kind: "ONBOARDING", id: plain.id }, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/not linked to a document type/i);
    // a step linked to an identification type needs sensitive access
    const step = (await listChecklistTemplates(w.hr, "ONBOARDING")).find((x) => x.taskName === "ID card issued")!;
    await updateTemplateItem(w.hr, step.id, { documentTypeId: w.type("NATIONAL_ID").id });
    const again = await w.hire("Second");
    const idTask = await db.onboardingTask.findFirstOrThrow({ where: { employeeId: again.id, taskName: "ID card issued" } });
    without("HR_ADMIN", "document.sensitive");
    await expect(uploadDocument(w.hr, { employeeId: again.id, task: { kind: "ONBOARDING", id: idTask.id }, file: { name: "id.png", bytes: png } } as never)).rejects.toThrow(/permission/);
    expect(uploadFor).toBeTruthy();
  });
});

describe("an exit step follows its document", () => {
  it("attaches exit documents to the exit process and completes the clearance step when approved", async () => {
    const w = await world();
    await linkStandardSteps(w.hr);
    const leaver = await w.hire("Leaver");
    const exit = await initiateExit(w.hr, { employeeId: leaver.id, exitType: "RESIGNATION", noticeDate: "2027-03-21", lastWorkingDate: "2027-03-31", reason: "Better offer elsewhere", reasonCategory: "BETTER_PAY" });
    await approveExit(w.boss, exit.id);
    const task = (name: string) => db.exitTask.findFirstOrThrow({ where: { exitRecordId: exit.id, taskName: name }, include: { document: true } });
    const step = await task("Exit interview conducted");
    expect(step.documentTypeId).toBe(w.type("EXIT_INTERVIEW").id);
    await expect(completeExitTask(w.hr, step.id)).rejects.toThrow(/completed by its document/i);
    const r = await uploadDocument(w.hr, { employeeId: leaver.id, task: { kind: "EXIT", id: step.id }, file: { name: "Exit interview.pdf", bytes: pdf("interview") } } as never);
    expect((await task("Exit interview conducted")).documentId).toBe(r.document.id);
    await submitDocument(w.hr, r.document.id);
    await approveDocument(w.reviewer, r.document.id);
    const done = await task("Exit interview conducted");
    expect(done.status).toBe("DONE");
    expect(done.completedBy).toMatch(/document approved/i);
    // a step with no document is completed by hand, as before
    const access = await task("System access revoked");
    await expect(completeExitTask(w.hr, access.id)).resolves.toMatchObject({ status: "DONE" });
  });
});
