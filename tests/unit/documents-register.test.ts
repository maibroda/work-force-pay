import { describe, expect, it } from "vitest";
import { REQUIREMENT_STATE_LABELS, requirementState } from "@/lib/documents";

// Electronic employee documents, part C: the central register and the missing-document tracking
// (the founder's request of 2026-11-07; his answer: a required document counts only when it is Approved).

const today = new Date("2026-11-08T00:00:00Z");
const past = new Date("2026-11-01T00:00:00Z");
const future = new Date("2027-06-01T00:00:00Z");
const doc = (status: string | null, expiryDate: Date | null = null) => ({ status: status as never, expiryDate });

describe("whether an employee has a required document", () => {
  it("only an approved document that has not expired counts as on file", () => {
    expect(requirementState([doc("APPROVED")], today)).toBe("PRESENT");
    expect(requirementState([doc("APPROVED", future)], today)).toBe("PRESENT");
    expect(requirementState([doc("APPROVED", today)], today)).toBe("PRESENT"); // valid through its expiry date
  });
  it("a document still in the workflow is never counted as on file", () => {
    expect(requirementState([doc("SUBMITTED")], today)).toBe("IN_REVIEW");
    expect(requirementState([doc("UNDER_REVIEW")], today)).toBe("IN_REVIEW");
    expect(requirementState([doc("PENDING")], today)).toBe("NOT_SUBMITTED");
    expect(requirementState([doc("REJECTED")], today)).toBe("REJECTED");
  });
  it("an approved document past its expiry is Expired, not on file", () => {
    expect(requirementState([doc("APPROVED", past)], today)).toBe("EXPIRED");
  });
  it("no document at all, or only archived or reference-only records, is Missing", () => {
    expect(requirementState([], today)).toBe("MISSING");
    expect(requirementState([doc("ARCHIVED")], today)).toBe("MISSING");
    expect(requirementState([doc(null)], today)).toBe("MISSING"); // a record from before document management has no approval
  });
  it("the best of several documents decides: a valid approved one beats everything else", () => {
    expect(requirementState([doc("REJECTED"), doc("APPROVED", future)], today)).toBe("PRESENT");
    expect(requirementState([doc("APPROVED", past), doc("APPROVED", future)], today)).toBe("PRESENT");
    expect(requirementState([doc("APPROVED", past), doc("SUBMITTED")], today)).toBe("IN_REVIEW"); // a renewal is awaiting approval
    expect(requirementState([doc("REJECTED"), doc("PENDING")], today)).toBe("NOT_SUBMITTED");
    expect(requirementState([doc("APPROVED", past), doc("REJECTED")], today)).toBe("REJECTED");
    expect(requirementState([doc("ARCHIVED"), doc("PENDING")], today)).toBe("NOT_SUBMITTED");
  });
  it("has a plain label for each state", () => {
    expect(Object.keys(REQUIREMENT_STATE_LABELS).sort()).toEqual(["EXPIRED", "IN_REVIEW", "MISSING", "NOT_SUBMITTED", "PRESENT", "REJECTED"]);
  });
});
