import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { ctxFor, isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { addTraining, revokeTraining } from "@/server/services/hr";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { addRequirement, complianceFor, complianceOverview, employeeCompliance, listRequirements, updateRequirement } from "@/server/services/training";
import { buildHrDigest } from "@/server/services/reminders";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;

const today = () => todayUtc();
const inDays = (n: number) => iso(addDays(today(), n));

async function worker(t: Org, first: string, opts: { office?: boolean; employedDaysAgo?: number } = {}) {
  return createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: "Trainee", employmentDate: inDays(-(opts.employedDaysAgo ?? 900)), categoryId: opts.office ? t.officeId : t.guardId });
}
const cert = (t: Org, employeeId: string, courseName: string, expiresInDays: number | null) =>
  addTraining(t.ctx("HR_ADMIN"), { employeeId, courseName, issueDate: inDays(-300), expiryDate: expiresInDays === null ? undefined : inDays(expiresInDays) });
const stateOf = async (t: Org, employeeId: string, course: string) => (await employeeCompliance(t.ctx("HR_ADMIN"), employeeId)).find((i) => i.requirement.courseName === course)?.assessment.state;

describe("requirements", () => {
  it("are added, edited, switched off and on, with duplicates and bad categories refused", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const everyone = await addRequirement(hr, { courseName: "First Aid", description: "Two-yearly", graceDays: 30 });
    expect(everyone).toMatchObject({ categoryId: null, graceDays: 30, active: true });
    await expect(addRequirement(hr, { courseName: "  first   AID " })).rejects.toThrow(/already a requirement for everyone/);
    await expect(addRequirement(hr, { courseName: "First Aid", categoryId: t.guardId })).rejects.toThrow(/already required of everyone/);
    await expect(addRequirement(hr, { courseName: "Fire Safety", categoryId: "no-such-category" })).rejects.toThrow(/category not found/);
    await expect(addRequirement(hr, { courseName: "ab" })).rejects.toThrow();
    await expect(addRequirement(hr, { courseName: "Long grace", graceDays: 400 })).rejects.toThrow();
    const other = await isolatedOrg();
    await expect(addRequirement(hr, { courseName: "Fire Safety", categoryId: other.guardId })).rejects.toThrow(/category not found/); // another org's

    const guardOnly = await addRequirement(hr, { courseName: "Armed Guard Licence", categoryId: t.guardId });
    await expect(addRequirement(hr, { courseName: "armed guard licence", categoryId: t.guardId })).rejects.toThrow(/already a requirement for that category/);
    await addRequirement(hr, { courseName: "Armed Guard Licence", categoryId: t.officeId }); // another category is fine

    const renamed = await updateRequirement(hr, guardOnly.id, { courseName: "Armed Licence", graceDays: 10, description: "Needs police clearance" });
    expect(renamed).toMatchObject({ courseName: "Armed Licence", graceDays: 10, description: "Needs police clearance", categoryId: t.guardId });
    expect((await updateRequirement(hr, guardOnly.id, { categoryId: undefined, courseName: "Armed Licence" } as never)).categoryId).toBeNull(); // now for everyone
    await expect(updateRequirement(hr, guardOnly.id, { courseName: "First Aid" })).rejects.toThrow(/already a requirement for everyone/);

    const off = await updateRequirement(hr, everyone.id, { active: false });
    expect(off.active).toBe(false);
    await addRequirement(hr, { courseName: "First Aid", categoryId: t.guardId }); // an "everyone" one that is off doesn't block a narrower one
    await expect(updateRequirement(hr, everyone.id, { active: true })).resolves.toMatchObject({ active: true }); // allowed: still no *active* duplicate of the same scope
    await expect(updateRequirement(hr, "nope", { active: false })).rejects.toThrow(/not found/);

    expect((await listRequirements(hr)).length).toBe(4);
  });

  it("can be changed only by HR configuration rights, and seen by those who can see HR data", async () => {
    const t = await isolatedOrg();
    await expect(addRequirement(t.ctx("AUDITOR"), { courseName: "First Aid" })).rejects.toThrow();
    await expect(addRequirement(t.ctx("PAYROLL_ADMIN"), { courseName: "First Aid" })).rejects.toThrow();
    const r = await addRequirement(t.ctx("HR_ADMIN"), { courseName: "First Aid" });
    await expect(updateRequirement(t.ctx("AUDITOR"), r.id, { active: false })).rejects.toThrow();
    expect((await listRequirements(t.ctx("AUDITOR"))).length).toBe(1);
    await expect(listRequirements(t.ctx("OPERATIONS"))).rejects.toThrow();
    await expect(complianceOverview(t.ctx("OPERATIONS"))).rejects.toThrow();
    const other = await isolatedOrg();
    await expect(updateRequirement(other.ctx("HR_ADMIN"), r.id, { active: false })).rejects.toThrow(/not found/);
    expect(await listRequirements(other.ctx("HR_ADMIN"))).toEqual([]);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "TRAINING_REQUIREMENT_ADD" } })).toBe(1);
  });
});

describe("compliance", () => {
  it("works out valid, expiring, expired and missing from the certificates on file", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await addRequirement(hr, { courseName: "First Aid" });
    const valid = await worker(t, "Valid");
    const expiring = await worker(t, "Expiring");
    const expired = await worker(t, "Expired");
    const missing = await worker(t, "Missing");
    await cert(t, valid.id, "First Aid", 400);
    await cert(t, expiring.id, "First Aid", 30);
    await cert(t, expired.id, "First Aid", -10);

    expect(await stateOf(t, valid.id, "First Aid")).toBe("VALID");
    expect(await stateOf(t, expiring.id, "First Aid")).toBe("EXPIRING");
    expect(await stateOf(t, expired.id, "First Aid")).toBe("EXPIRED");
    expect(await stateOf(t, missing.id, "First Aid")).toBe("MISSING");

    const o = await complianceOverview(hr);
    expect(o.totals).toMatchObject({ employees: 4, withRequirements: 4, compliant: 2, withGaps: 2, expired: 1, missing: 1, expiring: 1 });
    expect(o.perRequirement[0]).toMatchObject({ required: 4, valid: 1, expiring: 1, expired: 1, missing: 1 });
  });

  it("follows the alert window, and lets a renewal, a differently written name or no expiry cover a requirement", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await addRequirement(hr, { courseName: "First Aid" });
    const e = await worker(t, "Renewal");
    await cert(t, e.id, "First Aid", -50);
    expect(await stateOf(t, e.id, "First Aid")).toBe("EXPIRED");
    await cert(t, e.id, "  first aid ", 30); // a renewal, recorded in different case
    expect(await stateOf(t, e.id, "First Aid")).toBe("EXPIRING");
    await updateHrPolicy(hr, { trainingAlertDays: 20 });
    expect(await stateOf(t, e.id, "First Aid")).toBe("VALID");
    await updateHrPolicy(hr, { trainingAlertDays: 0 });
    expect(await stateOf(t, e.id, "First Aid")).toBe("VALID"); // 0 = only flag once expired
    await expect(updateHrPolicy(hr, { trainingAlertDays: 400 })).rejects.toThrow();

    const forever = await worker(t, "Forever");
    await cert(t, forever.id, "First Aid", null);
    expect(await stateOf(t, forever.id, "First Aid")).toBe("VALID");
  });

  it("ignores revoked certificates, and gives new joiners their grace period", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await addRequirement(hr, { courseName: "Fire Safety", graceDays: 60 });
    const revoked = await worker(t, "Revoked");
    const rec = await cert(t, revoked.id, "Fire Safety", 400);
    expect(await stateOf(t, revoked.id, "Fire Safety")).toBe("VALID");
    await revokeTraining(hr, rec.id, "Certificate was forged");
    expect(await stateOf(t, revoked.id, "Fire Safety")).toBe("MISSING");

    const joiner = await worker(t, "Joiner", { employedDaysAgo: 20 });
    const slow = await worker(t, "Slow", { employedDaysAgo: 70 });
    expect(await stateOf(t, joiner.id, "Fire Safety")).toBe("GRACE");
    expect(await stateOf(t, slow.id, "Fire Safety")).toBe("MISSING");
    const o = await complianceOverview(hr);
    expect(o.rows.find((r) => r.employee.id === joiner.id)!.compliant).toBe(true); // grace isn't a gap
    expect(o.rows.find((r) => r.employee.id === slow.id)!.gaps).toBe(1);
  });

  it("applies category requirements only to that category, and leaves out leavers and switched-off requirements", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const armed = await addRequirement(hr, { courseName: "Armed Guard Licence", categoryId: t.guardId });
    await addRequirement(hr, { courseName: "Data Protection" }); // everyone
    const guard = await worker(t, "Guard");
    const clerk = await worker(t, "Clerk", { office: true });
    const leaver = await worker(t, "Leaver");
    await db.employee.update({ where: { id: leaver.id }, data: { status: "RESIGNED" } });

    expect((await employeeCompliance(hr, guard.id)).map((i) => i.requirement.courseName).sort()).toEqual(["Armed Guard Licence", "Data Protection"]);
    expect((await employeeCompliance(hr, clerk.id)).map((i) => i.requirement.courseName)).toEqual(["Data Protection"]);
    expect((await complianceOverview(hr)).totals.employees).toBe(2); // the leaver isn't measured

    await updateRequirement(hr, armed.id, { active: false });
    expect((await employeeCompliance(hr, guard.id)).map((i) => i.requirement.courseName)).toEqual(["Data Protection"]);
    await expect(employeeCompliance(hr, "ghost")).rejects.toThrow(/not found/);
  });

  it("keeps each organization's requirements and certificates to itself", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    await addRequirement(a.ctx("HR_ADMIN"), { courseName: "First Aid" });
    const eb = await worker(b, "Other");
    await cert(b, eb.id, "First Aid", 400);
    expect((await complianceFor(b.org.id)).totals).toMatchObject({ employees: 1, withRequirements: 0 });
    expect((await complianceFor(a.org.id)).totals.employees).toBe(0);
    await expect(employeeCompliance(a.ctx("HR_ADMIN"), eb.id)).rejects.toThrow(/not found/);
  });
});

describe("HR digest", () => {
  it("lists expired or missing required training and certificates expiring soon, and goes quiet when covered", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@train.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    await addRequirement(hr, { courseName: "First Aid" });
    await addRequirement(hr, { courseName: "Fire Safety" });
    const a = await worker(t, "Ann");
    const b = await worker(t, "Bob");
    await cert(t, a.id, "First Aid", -5);
    await cert(t, a.id, "Fire Safety", 400);
    await cert(t, b.id, "First Aid", 20);
    await cert(t, b.id, "Fire Safety", 400);

    const d = await buildHrDigest(t.org.id);
    const gaps = d.sections.find((s) => s.key === "training")!;
    expect(gaps.count).toBe(1);
    expect(gaps.items[0].text).toMatch(/EMP-\d+ Ann Trainee — First Aid \(expired /);
    expect(gaps.items[0].path).toBe(`/employees/${a.id}?tab=documents`);
    const soon = d.sections.find((s) => s.key === "training-expiring")!;
    expect(soon.items.map((i) => i.text).join()).toMatch(/Bob Trainee — First Aid expires/);
    expect(d.total).toBe(d.sections.reduce((s, x) => s + x.count, 0));

    await cert(t, a.id, "First Aid", 400);
    await cert(t, b.id, "First Aid", 400);
    const quiet = await buildHrDigest(t.org.id);
    expect(quiet.sections.map((s) => s.key)).not.toContain("training");
    expect(quiet.sections.map((s) => s.key)).not.toContain("training-expiring");
  });
});

describe("demo data", () => {
  it("seeds the demo organization with every state", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const o = await complianceOverview(hr);
    expect(o.requirements.length).toBeGreaterThanOrEqual(3);
    expect(o.totals.expired).toBeGreaterThan(0);
    expect(o.totals.missing).toBeGreaterThan(0);
    expect(o.totals.expiring).toBeGreaterThan(0);
    expect(o.totals.compliant).toBeGreaterThan(0);
    // category-specific requirement applies only to guards
    const basic = o.perRequirement.find((p) => p.requirement.courseName === "Basic Security Guard Training")!;
    expect(basic.required).toBeLessThan(o.totals.employees);
  });
});
