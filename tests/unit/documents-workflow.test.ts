import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, can, type Permission, type Role } from "@/lib/auth/permissions";
import { STANDARD_STEP_LINKS, STANDARD_TYPES, taskStateFromDocument, TASK_STATE_LABELS } from "@/lib/documents";
import { DEFAULT_EXIT_TEMPLATE, DEFAULT_ONBOARDING_TEMPLATE } from "@/server/services/hr-policy";

// Electronic employee documents, part B: the approval workflow and the onboarding and exit links
// (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md).

const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
const holding = (p: string) => roles.filter((r) => can(r, p as Permission)).sort();

describe("who may approve a document", () => {
  it("is the HR administrator, the company administrator and the super administrator, and nobody else", () => {
    expect(PERMISSIONS).toContain("document.approve");
    expect(holding("document.approve")).toEqual(["COMPANY_ADMIN", "HR_ADMIN", "SUPER_ADMIN"]);
  });
  it("is never held without the right to manage and to see documents", () => {
    for (const r of roles) if (can(r, "document.approve" as Permission)) expect(can(r, "document.manage" as Permission) && can(r, "document.view" as Permission), r).toBe(true);
  });
});

describe("what a checklist step shows, from its document", () => {
  it("no document, or one not yet submitted, is Pending", () => {
    expect(taskStateFromDocument(null)).toBe("PENDING");
    expect(taskStateFromDocument(undefined)).toBe("PENDING");
    expect(taskStateFromDocument("PENDING")).toBe("PENDING");
  });
  it("submitted is Submitted, taken by a reviewer is Under review, approved is Completed", () => {
    expect(taskStateFromDocument("SUBMITTED")).toBe("SUBMITTED");
    expect(taskStateFromDocument("UNDER_REVIEW")).toBe("UNDER_REVIEW");
    expect(taskStateFromDocument("APPROVED")).toBe("COMPLETED");
  });
  it("a rejected, expired-and-replaced or archived document leaves the step Pending", () => {
    expect(taskStateFromDocument("REJECTED")).toBe("PENDING");
    expect(taskStateFromDocument("ARCHIVED")).toBe("PENDING");
  });
  it("has a plain label for each state", () => {
    expect(TASK_STATE_LABELS).toEqual({ PENDING: "Pending", SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", COMPLETED: "Completed" });
  });
});

describe("the standard checklist steps that have an obvious document", () => {
  it("each names a step that exists in the default checklist and a type that exists in the standard types", () => {
    const onboarding = new Set(DEFAULT_ONBOARDING_TEMPLATE.map((s) => s.taskName));
    const exit = new Set(DEFAULT_EXIT_TEMPLATE.map((s) => s.taskName));
    const codes = new Set(STANDARD_TYPES.map((t) => t.code));
    for (const [step, code] of Object.entries(STANDARD_STEP_LINKS.ONBOARDING)) {
      expect(onboarding.has(step), step).toBe(true);
      expect(codes.has(code), code).toBe(true);
    }
    for (const [step, code] of Object.entries(STANDARD_STEP_LINKS.EXIT_CLEARANCE)) {
      expect(exit.has(step), step).toBe(true);
      expect(codes.has(code), code).toBe(true);
    }
  });
  it("leave the broad and non-document steps alone", () => {
    expect(STANDARD_STEP_LINKS.ONBOARDING["Documents collected (ID, certificates, references)"]).toBeUndefined();
    expect(STANDARD_STEP_LINKS.ONBOARDING["ID card issued"]).toBeUndefined();
    expect(STANDARD_STEP_LINKS.EXIT_CLEARANCE["System access revoked"]).toBeUndefined();
    expect(STANDARD_STEP_LINKS.EXIT_CLEARANCE["Final settlement computed"]).toBeUndefined();
  });
  it("link the steps the founder named", () => {
    expect(STANDARD_STEP_LINKS.ONBOARDING).toMatchObject({ "Offer letter signed": "OFFER_LETTER", "Employment contract signed & filed": "EMPLOYMENT_CONTRACT", "Medical examination": "MEDICAL_EXAMINATION_REPORT", "Guard / firearms license verified": "LICENCE" });
    expect(STANDARD_STEP_LINKS.EXIT_CLEARANCE).toMatchObject({ "Handover of duties": "HANDOVER_FORM", "Exit interview conducted": "EXIT_INTERVIEW", "Clearance sign-off": "CLEARANCE_FORM", "Return of company property / equipment": "ASSET_RETURN" });
  });
});
