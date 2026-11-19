import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { acknowledge, createPolicy, getPolicy, markPolicyReviewed, myPolicies, policyAttention, policyReviewsDue, publishVersion, recordAcknowledgement, setPolicyStatus, updatePolicy } from "@/server/services/policies";
import { buildHrDigest } from "@/server/services/reminders";

// Handbook and procedures (slice 4B, approved by the founder on 2026-11-17: plan docs/plans/hr-phases-4-5-plan.md, section 6 as recommended). The policy area also holds a HANDBOOK and standard
// operating procedures (SOP): the same versions, effective dates and audience by category, but acknowledgement is required only where HR asks for it (on for a policy, off for a handbook or SOP,
// switchable per item), and an optional review date puts an overdue item in the HR digest. A policy created the old way behaves exactly as before.

type Org = Awaited<ReturnType<typeof isolatedOrg>>;
const day = (n: number) => iso(addDays(todayUtc(), n));
const staff = (t: Org, first: string, opts: { office?: boolean } = {}) =>
  createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: "Reader", employmentDate: "2023-01-01", categoryId: opts.office ? t.officeId : t.guardId } as never);
// CHANGED 2026-11-17 on purpose (sop-review-date, approved by the founder): a procedure (SOP) now needs a review date, so unless a test says otherwise a procedure here is made with one.
// The rule itself is tested in policy-sop-review.test.ts; every other behaviour tested here is unchanged.
const item = (over: Record<string, unknown> = {}) => ({ title: `Item ${uid()}`, summary: "Read it", body: "Step one. Step two.", graceDays: 14, ...(over.kind === "SOP" && !("reviewDueOn" in over) ? { reviewDueOn: day(90) } : {}), ...over });

describe("kinds, and the default that changes nothing", () => {
  it("a policy created the old way is a POLICY that must be acknowledged, exactly as before", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, item());
    expect(p).toMatchObject({ kind: "POLICY", acknowledgementRequired: true, reviewDueOn: null });
    const ann = await staff(t, "Ann");
    expect((await myPolicies(t.ctx("EMPLOYEE", ann.id)))[0]).toMatchObject({ state: "PENDING" });
    await acknowledge(t.ctx("EMPLOYEE", ann.id), p.id);
    expect((await myPolicies(t.ctx("EMPLOYEE", ann.id)))[0]).toMatchObject({ state: "ACKNOWLEDGED" });
  });
  it("a handbook or an SOP does not need acknowledging unless HR says so; a policy can be created that does not need it", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    expect(await createPolicy(hr, item({ kind: "HANDBOOK" }))).toMatchObject({ kind: "HANDBOOK", acknowledgementRequired: false });
    expect(await createPolicy(hr, item({ kind: "SOP" }))).toMatchObject({ kind: "SOP", acknowledgementRequired: false });
    expect(await createPolicy(hr, item({ kind: "POLICY", acknowledgementRequired: false }))).toMatchObject({ kind: "POLICY", acknowledgementRequired: false });
    expect(await createPolicy(hr, item({ kind: "HANDBOOK", acknowledgementRequired: true }))).toMatchObject({ kind: "HANDBOOK", acknowledgementRequired: true });
  });
  it("refuses an unknown kind, never changes a kind afterwards, and keeps titles different across kinds", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await expect(createPolicy(hr, item({ kind: "MEMO" }))).rejects.toThrow();
    const sop = await createPolicy(hr, item({ kind: "SOP", title: "Opening the site" }));
    await updatePolicy(hr, sop.id, { kind: "POLICY" } as never);
    expect((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).kind).toBe("SOP");
    await expect(createPolicy(hr, item({ kind: "HANDBOOK", title: "opening the SITE" }))).rejects.toThrow(/already/i);
  });
  it("is written by those who may configure policies, and no one else, and stays within the company", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    for (const role of ["FINANCE", "AUDITOR", "SUPERVISOR", "EMPLOYEE"] as const) await expect(createPolicy(t.ctx(role), item({ kind: "SOP" })), role).rejects.toThrow(/permission/);
    const sop = await createPolicy(hr, item({ kind: "SOP" }));
    for (const role of ["FINANCE", "AUDITOR", "EMPLOYEE"] as const) await expect(updatePolicy(t.ctx(role), sop.id, { acknowledgementRequired: true } as never), role).rejects.toThrow(/permission/);
    await expect(updatePolicy((await isolatedOrg()).ctx("HR_ADMIN"), sop.id, { acknowledgementRequired: true } as never)).rejects.toThrow(/not found/i);
  });
});

describe("reading without acknowledging", () => {
  it("shows an employee a handbook that is in effect and for them, with nothing to acknowledge, and refuses an acknowledgement of it, by them or on their behalf", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const book = await createPolicy(hr, item({ kind: "HANDBOOK", title: "Staff handbook" }));
    const ann = await staff(t, "Ann");
    const mine = await myPolicies(t.ctx("EMPLOYEE", ann.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ state: "NOT_REQUIRED", policy: { kind: "HANDBOOK", title: "Staff handbook" } });
    await expect(acknowledge(t.ctx("EMPLOYEE", ann.id), book.id)).rejects.toThrow(/doesn't need|does not need/i);
    await expect(recordAcknowledgement(hr, book.id, ann.id, "Signed sheet HR/1")).rejects.toThrow(/doesn't need|does not need/i);
  });
  it("is shown only when it has taken effect and only to the category it is for", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await createPolicy(hr, item({ kind: "SOP", title: "Guard post orders", categoryId: t.guardId }));
    await createPolicy(hr, item({ kind: "SOP", title: "Future procedure", effectiveDate: day(10) }));
    const guard = await staff(t, "Gina");
    const clerk = await staff(t, "Cleo", { office: true });
    expect((await myPolicies(t.ctx("EMPLOYEE", guard.id))).map((i) => i.policy.title)).toEqual(["Guard post orders"]);
    expect(await myPolicies(t.ctx("EMPLOYEE", clerk.id))).toEqual([]);
  });
  it("owes nothing: no pending, no overdue, never in the acknowledgement chase or the HR digest", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@kind.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const book = await createPolicy(hr, item({ kind: "HANDBOOK", effectiveDate: day(-60) }));
    await staff(t, "Ann");
    await staff(t, "Bob");
    const c = (await getPolicy(hr, book.id))!;
    expect(c.totals).toMatchObject({ applicable: 2, acknowledged: 0, pending: 0, overdue: 0 });
    expect(c.rows.every((r) => r.state === "NOT_REQUIRED")).toBe(true);
    expect(await policyAttention(t.org.id, todayUtc())).toEqual([]);
    expect((await buildHrDigest(t.org.id)).sections.map((s) => s.key)).not.toContain("policies");
  });
  it("asks nobody to acknowledge again when a new version is published", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const sop = await createPolicy(hr, item({ kind: "SOP", effectiveDate: day(-30) }));
    const ann = await staff(t, "Ann");
    await publishVersion(hr, sop.id, { body: "A new step three.", changeSummary: "Added step three", effectiveDate: day(0) });
    const mine = await myPolicies(t.ctx("EMPLOYEE", ann.id));
    expect(mine[0]).toMatchObject({ state: "NOT_REQUIRED", version: { version: 2 } });
    expect(await policyAttention(t.org.id, todayUtc())).toEqual([]);
  });
});

describe("switching acknowledgement on and off", () => {
  it("chases an item from the moment HR makes it required, and stops when HR switches it off, keeping what people already acknowledged", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const sop = await createPolicy(hr, item({ kind: "SOP", effectiveDate: day(-40) }));
    const ann = await staff(t, "Ann");
    await staff(t, "Bob");
    expect(await policyAttention(t.org.id, todayUtc())).toEqual([]);
    await updatePolicy(hr, sop.id, { acknowledgementRequired: true } as never);
    expect((await policyAttention(t.org.id, todayUtc()))[0]).toMatchObject({ overdue: 2, applicable: 2 });
    await acknowledge(t.ctx("EMPLOYEE", ann.id), sop.id);
    await updatePolicy(hr, sop.id, { acknowledgementRequired: false } as never);
    expect(await policyAttention(t.org.id, todayUtc())).toEqual([]);
    expect((await myPolicies(t.ctx("EMPLOYEE", ann.id)))[0]).toMatchObject({ state: "NOT_REQUIRED" });
    // switched on again, Ann's earlier acknowledgement of this version still stands
    await updatePolicy(hr, sop.id, { acknowledgementRequired: true } as never);
    expect((await myPolicies(t.ctx("EMPLOYEE", ann.id)))[0]).toMatchObject({ state: "ACKNOWLEDGED" });
    expect((await policyAttention(t.org.id, todayUtc()))[0]).toMatchObject({ overdue: 1, applicable: 2 });
  });
  it("is recorded in the audit log", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const sop = await createPolicy(hr, item({ kind: "SOP" }));
    await updatePolicy(hr, sop.id, { acknowledgementRequired: true } as never);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "POLICY_UPDATE", entityId: sop.id } })).toBe(1);
  });
});

describe("the review date", () => {
  it("is optional for a handbook (a procedure needs one: policy-sop-review.test.ts), can be set when the item is made or later, and must be a real date", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    expect((await createPolicy(hr, item({ kind: "HANDBOOK" }))).reviewDueOn).toBeNull();
    const withDate = await createPolicy(hr, item({ kind: "HANDBOOK", reviewDueOn: day(90) }));
    expect(iso(withDate.reviewDueOn!)).toBe(day(90));
    await expect(createPolicy(hr, item({ reviewDueOn: "next spring" }))).rejects.toThrow();
    await updatePolicy(hr, withDate.id, { reviewDueOn: day(200) } as never);
    expect(iso((await db.companyPolicy.findUniqueOrThrow({ where: { id: withDate.id } })).reviewDueOn!)).toBe(day(200));
    await updatePolicy(hr, withDate.id, { reviewDueOn: null } as never);
    expect((await db.companyPolicy.findUniqueOrThrow({ where: { id: withDate.id } })).reviewDueOn).toBeNull();
  });
  it("puts an active item past its review date in the HR digest with a link, and ignores future dates, no date and archived items", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@kind.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const due = await createPolicy(hr, item({ kind: "SOP", title: "Cash handling", reviewDueOn: day(-3) }));
    await createPolicy(hr, item({ kind: "SOP", title: "Later review", reviewDueOn: day(30) }));
    await createPolicy(hr, item({ kind: "HANDBOOK", title: "No review date" }));
    const archived = await createPolicy(hr, item({ kind: "SOP", title: "Old procedure", reviewDueOn: day(-100) }));
    await setPolicyStatus(hr, archived.id, "ARCHIVED");
    const list = await policyReviewsDue(t.org.id, todayUtc());
    expect(list.map((x) => x.policy.title)).toEqual(["Cash handling"]);
    const sec = (await buildHrDigest(t.org.id)).sections.find((s) => s.key === "policy-reviews")!;
    expect(sec.items).toHaveLength(1);
    expect(sec.items[0]).toMatchObject({ path: `/hr/policies/${due.id}` });
    expect(sec.items[0].text).toMatch(/Cash handling.*review was due/);
  });
  it("is cleared by marking the item reviewed, with the next review date, and that is audited by ids and dates", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const sop = await createPolicy(hr, item({ kind: "SOP", reviewDueOn: day(-5) }));
    for (const role of ["FINANCE", "AUDITOR", "EMPLOYEE"] as const) await expect(markPolicyReviewed(t.ctx(role), sop.id, day(365)), role).rejects.toThrow(/permission/);
    await expect(markPolicyReviewed(hr, sop.id, "someday")).rejects.toThrow();
    await expect(markPolicyReviewed(hr, sop.id, day(-1))).rejects.toThrow(/past|future/i);
    await markPolicyReviewed(hr, sop.id, day(365));
    expect(iso((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).reviewDueOn!)).toBe(day(365));
    expect(await policyReviewsDue(t.org.id, todayUtc())).toEqual([]);
    // CHANGED 2026-11-17 on purpose: this step used to clear the date ("or none"); a procedure now always has a next review date (a handbook may still have none: policy-sop-review.test.ts)
    await markPolicyReviewed(hr, sop.id, day(200));
    expect(iso((await db.companyPolicy.findUniqueOrThrow({ where: { id: sop.id } })).reviewDueOn!)).toBe(day(200));
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, action: "POLICY_REVIEWED", entityId: sop.id } });
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).toContain(day(365));
    await expect(markPolicyReviewed((await isolatedOrg()).ctx("HR_ADMIN"), sop.id, day(30))).rejects.toThrow(/not found/i);
  });
});

// Added 2026-11-19 (the founder chose "yes, add the line" for undated SOPs in the HR digest): a procedure with no review date (an older one, from before the date became mandatory) is listed in the
// digest by title with a link, so it gets a date at its next edit. A dated procedure, a handbook, a policy and an archived procedure are not listed.
describe("the HR digest and procedures with no review date", () => {
  it("lists an active procedure with no review date by title and link, and nothing else", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const today = new Date(`${day(0)}T00:00:00Z`);
    expect((await buildHrDigest(t.org.id, today)).sections.map((s) => s.key)).not.toContain("sops-undated");
    const old = await createPolicy(hr, item({ kind: "SOP", title: "Old post orders" }));
    await db.companyPolicy.update({ where: { id: old.id }, data: { reviewDueOn: null } }); // an older procedure, from before the date became mandatory
    await createPolicy(hr, item({ kind: "SOP", title: "Dated post orders" })); // has a review date
    await createPolicy(hr, item({ kind: "HANDBOOK", title: "Staff handbook" })); // may have none
    await createPolicy(hr, item({ title: "Code of conduct" })); // a policy
    const archived = await createPolicy(hr, item({ kind: "SOP", title: "Archived orders" }));
    await db.companyPolicy.update({ where: { id: archived.id }, data: { reviewDueOn: null } });
    await setPolicyStatus(hr, archived.id, "ARCHIVED");
    const sec = (await buildHrDigest(t.org.id, today)).sections.find((s) => s.key === "sops-undated")!;
    expect(sec.count).toBe(1);
    expect(sec.items).toEqual([{ text: "Old post orders — no review date set", path: `/hr/policies/${old.id}` }]);
  });

  it("drops off the digest once the procedure is given a date", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const today = new Date(`${day(0)}T00:00:00Z`);
    const old = await createPolicy(hr, item({ kind: "SOP", title: "Old post orders" }));
    await db.companyPolicy.update({ where: { id: old.id }, data: { reviewDueOn: null } });
    expect((await buildHrDigest(t.org.id, today)).sections.map((s) => s.key)).toContain("sops-undated");
    await markPolicyReviewed(hr, old.id, day(200));
    expect((await buildHrDigest(t.org.id, today)).sections.map((s) => s.key)).not.toContain("sops-undated");
  });

  it("is about this company only", async () => {
    const t = await isolatedOrg();
    const other = await isolatedOrg();
    const old = await createPolicy(other.ctx("HR_ADMIN"), item({ kind: "SOP", title: "Their orders" }));
    await db.companyPolicy.update({ where: { id: old.id }, data: { reviewDueOn: null } });
    expect((await buildHrDigest(t.org.id, new Date(`${day(0)}T00:00:00Z`))).sections.map((s) => s.key)).not.toContain("sops-undated");
  });
});
