import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { addMonths } from "@/lib/leave";
import { isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { createPolicy, markPolicyReviewed, myPolicies, publishVersion, updatePolicy } from "@/server/services/policies";

// A procedure (SOP) needs a review date (founder, 2026-11-17: "approved as recommended"): no later than the company's number of months (12 unless changed) after it takes effect. Publishing a
// new version and marking it reviewed need one too. Existing procedures without a date are not blocked: they are flagged, and the next edit must set one. Handbooks and policies stay optional.

const day = (n: number) => iso(addDays(todayUtc(), n));
const monthsOut = (n: number, from = todayUtc()) => iso(addMonths(from, n));
const item = (over: Record<string, unknown> = {}) => ({ title: `Item ${uid()}`, summary: "Read it", body: "Step one. Step two.", graceDays: 14, ...over });

async function world() {
  const t = await isolatedOrg();
  return { t, hr: t.ctx("HR_ADMIN"), boss: t.ctx("COMPANY_ADMIN") };
}

describe("the company setting", () => {
  it("is twelve months until the company changes it, and must be a whole number of months from 1 to 60", async () => {
    const { t, boss } = await world();
    expect((await getHrPolicy(t.org.id)).sopReviewMonths).toBe(12);
    await updateHrPolicy(boss, { sopReviewMonths: 6 });
    expect((await getHrPolicy(t.org.id)).sopReviewMonths).toBe(6);
    for (const bad of [0, 61, 2.5]) await expect(updateHrPolicy(boss, { sopReviewMonths: bad }), String(bad)).rejects.toThrow();
  });
});

describe("making a procedure", () => {
  it("needs a review date, no later than the setting's months after it takes effect", async () => {
    const { hr } = await world();
    await expect(createPolicy(hr, item({ kind: "SOP" }))).rejects.toThrow(/review date/i);
    await expect(createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(400) }))).rejects.toThrow(/can't be later than/i);
    const ok = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: monthsOut(12) }));
    expect(iso(ok.reviewDueOn!)).toBe(monthsOut(12));
  });

  it("counts the months from the day it takes effect, when that is in the future", async () => {
    const { hr } = await world();
    const effective = day(100);
    const limit = monthsOut(12, addDays(todayUtc(), 100));
    await expect(createPolicy(hr, item({ kind: "SOP", effectiveDate: effective, reviewDueOn: iso(addDays(new Date(`${limit}T00:00:00Z`), 1)) }))).rejects.toThrow(/can't be later than/i);
    await expect(createPolicy(hr, item({ kind: "SOP", effectiveDate: effective, reviewDueOn: limit }))).resolves.toBeTruthy();
  });

  it("follows the company's own number of months", async () => {
    const { hr, boss } = await world();
    await updateHrPolicy(boss, { sopReviewMonths: 6 });
    await expect(createPolicy(hr, item({ kind: "SOP", reviewDueOn: monthsOut(7) }))).rejects.toThrow(/can't be later than/i);
    await expect(createPolicy(hr, item({ kind: "SOP", reviewDueOn: monthsOut(6) }))).resolves.toBeTruthy();
  });

  it("leaves a handbook and a policy as they were: a review date is optional, however far off", async () => {
    const { hr } = await world();
    expect((await createPolicy(hr, item({ kind: "HANDBOOK" }))).reviewDueOn).toBeNull();
    expect((await createPolicy(hr, item({ kind: "POLICY" }))).reviewDueOn).toBeNull();
    expect(iso((await createPolicy(hr, item({ kind: "HANDBOOK", reviewDueOn: day(1500) }))).reviewDueOn!)).toBe(day(1500));
  });
});

describe("editing a procedure, including one that has no date (made before this rule)", () => {
  async function undated() {
    const w = await world();
    const sop = await createPolicy(w.hr, item({ kind: "SOP", reviewDueOn: day(90) }));
    await db.companyPolicy.update({ where: { id: sop.id }, data: { reviewDueOn: null } }); // as it was before the rule
    return { ...w, sop };
  }

  it("is not blocked or changed by the rule: an undated procedure is still read, still listed, and employees still see it", async () => {
    const { t, hr, sop } = await undated();
    const ann = await createEmployee(hr, { firstName: "Ann", lastName: "Reader", employmentDate: "2023-01-01", categoryId: t.guardId } as never);
    expect((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).reviewDueOn).toBeNull();
    expect((await myPolicies(t.ctx("EMPLOYEE", ann.id))).map((i) => i.policy.id)).toContain(sop.id);
  });

  it("the next edit must set a review date, within the window; leaving it blank or too far off is refused", async () => {
    const { hr, sop } = await undated();
    await expect(updatePolicy(hr, sop.id, { summary: "A new summary" } as never)).rejects.toThrow(/review date/i);
    await expect(updatePolicy(hr, sop.id, { summary: "A new summary", reviewDueOn: "" } as never)).rejects.toThrow(/review date/i);
    await expect(updatePolicy(hr, sop.id, { reviewDueOn: day(500) } as never)).rejects.toThrow(/can't be later than/i);
    const u = await updatePolicy(hr, sop.id, { summary: "A new summary", reviewDueOn: day(200) } as never);
    expect(iso(u.reviewDueOn!)).toBe(day(200));
  });

  it("a procedure that already has a date can be edited without giving one again, but the date can never be cleared", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(90) }));
    await expect(updatePolicy(hr, sop.id, { summary: "Edited" } as never)).resolves.toBeTruthy();
    await expect(updatePolicy(hr, sop.id, { reviewDueOn: "" } as never)).rejects.toThrow(/review date/i);
  });

  it("a handbook can still have its review date cleared", async () => {
    const { hr } = await world();
    const book = await createPolicy(hr, item({ kind: "HANDBOOK", reviewDueOn: day(90) }));
    expect((await updatePolicy(hr, book.id, { reviewDueOn: "" } as never)).reviewDueOn).toBeNull();
  });
});

describe("publishing a new version of a procedure", () => {
  const version = (over: Record<string, unknown> = {}) => ({ body: "New wording.", changeSummary: "Reworded", ...over });

  it("is refused with no review date on file, or one beyond the window for the new version", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(90) }));
    await db.companyPolicy.update({ where: { id: sop.id }, data: { reviewDueOn: null } });
    await expect(publishVersion(hr, sop.id, version() as never)).rejects.toThrow(/review date/i);
    await expect(publishVersion(hr, sop.id, version({ reviewDueOn: day(500) }) as never)).rejects.toThrow(/can't be later than/i);
    expect(await db.policyVersion.count({ where: { policyId: sop.id } })).toBe(1); // nothing was published
  });

  it("can set the review date at the same time, and then the new version is published", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(90) }));
    await db.companyPolicy.update({ where: { id: sop.id }, data: { reviewDueOn: null } });
    await publishVersion(hr, sop.id, version({ reviewDueOn: day(180) }) as never);
    expect(iso((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).reviewDueOn!)).toBe(day(180));
    expect(await db.policyVersion.count({ where: { policyId: sop.id } })).toBe(2);
  });

  it("goes ahead when a valid date is already on file, and a handbook never needs one", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(90) }));
    await expect(publishVersion(hr, sop.id, version() as never)).resolves.toBeTruthy();
    const book = await createPolicy(hr, item({ kind: "HANDBOOK" }));
    await expect(publishVersion(hr, book.id, version() as never)).resolves.toBeTruthy();
  });
});

describe("marking a procedure reviewed", () => {
  it("needs the next review date, no later than the setting's months from today", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(-5) }));
    await expect(markPolicyReviewed(hr, sop.id, null)).rejects.toThrow(/review date/i);
    await expect(markPolicyReviewed(hr, sop.id, day(400))).rejects.toThrow(/can't be later than/i);
    await markPolicyReviewed(hr, sop.id, monthsOut(12));
    expect(iso((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).reviewDueOn!)).toBe(monthsOut(12));
  });

  it("is counted from today even for a procedure that took effect long ago", async () => {
    const { hr } = await world();
    const sop = await createPolicy(hr, item({ kind: "SOP", effectiveDate: day(-900), reviewDueOn: day(-5) }));
    await expect(markPolicyReviewed(hr, sop.id, monthsOut(12))).resolves.toBeTruthy();
  });

  it("leaves a handbook as it was: it can be marked reviewed with no next date", async () => {
    const { hr } = await world();
    const book = await createPolicy(hr, item({ kind: "HANDBOOK", reviewDueOn: day(-5) }));
    await expect(markPolicyReviewed(hr, book.id, null)).resolves.toBeTruthy();
    expect((await db.companyPolicy.findUniqueOrThrow({ where: { id: book.id } })).reviewDueOn).toBeNull();
  });
});
