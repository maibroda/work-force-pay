import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { ctxFor, isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import {
  acknowledge,
  createPolicy,
  employeePolicies,
  getPolicy,
  listPolicies,
  myPolicies,
  policyAttention,
  publishVersion,
  recordAcknowledgement,
  setPolicyStatus,
  updatePolicy,
} from "@/server/services/policies";
import { buildHrDigest } from "@/server/services/reminders";

type Org = Awaited<ReturnType<typeof isolatedOrg>>;

const day = (n: number) => iso(addDays(todayUtc(), n));
const staff = (t: Org, first: string, opts: { office?: boolean; employed?: string } = {}) =>
  createEmployee(t.ctx("HR_ADMIN"), { firstName: first, lastName: "Reader", employmentDate: opts.employed ?? "2023-01-01", categoryId: opts.office ? t.officeId : t.guardId });
const conduct = (over: Record<string, unknown> = {}) => ({ title: `Code of Conduct ${uid()}`, summary: "How we behave", body: "Be honest. Be on time.", graceDays: 14, ...over });
const rowOf = async (t: Org, policyId: string, employeeId: string) => (await getPolicy(t.ctx("HR_ADMIN"), policyId))!.rows.find((r) => r.employee.id === employeeId);

describe("publishing a policy", () => {
  it("creates version 1, and validates what's given", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct({ title: "Data Protection" }));
    const [v] = await db.policyVersion.findMany({ where: { policyId: p.id } });
    expect(v).toMatchObject({ version: 1, publishedBy: hr.name });
    expect(iso(v.effectiveDate)).toBe(day(0));
    expect(p).toMatchObject({ categoryId: null, status: "ACTIVE", graceDays: 14 });

    await expect(createPolicy(hr, conduct({ title: "data protection" }))).rejects.toThrow(/already a policy called/);
    await expect(createPolicy(hr, conduct({ body: undefined }))).rejects.toThrow(/text, a document reference/);
    await expect(createPolicy(hr, conduct({ title: "ab" }))).rejects.toThrow();
    await expect(createPolicy(hr, conduct({ categoryId: "nope" }))).rejects.toThrow(/category not found/);
    await expect(createPolicy(hr, conduct({ effectiveDate: "not-a-date" }))).rejects.toThrow(/isn't valid/);
    await expect(createPolicy(hr, conduct({ graceDays: 400 }))).rejects.toThrow();
    const other = await isolatedOrg();
    await expect(createPolicy(hr, conduct({ categoryId: other.guardId }))).rejects.toThrow(/category not found/);
    // a document reference alone is enough
    expect((await createPolicy(hr, conduct({ body: undefined, documentReference: "HR/POL/012" }))).id).toBeTruthy();
    await expect(createPolicy(t.ctx("AUDITOR"), conduct())).rejects.toThrow();
    await expect(createPolicy(t.ctx("OPERATIONS"), conduct())).rejects.toThrow();
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "POLICY_CREATE" } })).toBe(2);
  });
});

describe("acknowledging", () => {
  it("lets an employee acknowledge the current version once, and shows it to HR", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct());
    const e = await staff(t, "Reader");
    const me = t.ctx("EMPLOYEE", e.id);

    expect((await myPolicies(me)).map((i) => [i.policy.id, i.state])).toEqual([[p.id, "PENDING"]]);
    expect((await rowOf(t, p.id, e.id))!.state).toBe("PENDING");
    const a = await acknowledge(me, p.id);
    expect(a.method).toBe("SELF");
    expect((await myPolicies(me))[0]).toMatchObject({ state: "ACKNOWLEDGED", method: "SELF" });
    expect((await rowOf(t, p.id, e.id))).toMatchObject({ state: "ACKNOWLEDGED", method: "SELF" });
    await expect(acknowledge(me, p.id)).rejects.toThrow(/already been acknowledged/);
    expect((await employeePolicies(hr, e.id))[0].state).toBe("ACKNOWLEDGED");
    await expect(employeePolicies(t.ctx("OPERATIONS"), e.id)).rejects.toThrow();
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "POLICY_ACK" } })).toBe(1);
  });

  it("only applies a category policy to that category, and rules out people who can't acknowledge", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const guardsOnly = await createPolicy(hr, conduct({ title: "Use of Force", categoryId: t.guardId }));
    const guard = await staff(t, "Guard");
    const clerk = await staff(t, "Clerk", { office: true });
    expect((await myPolicies(t.ctx("EMPLOYEE", guard.id))).length).toBe(1);
    expect(await myPolicies(t.ctx("EMPLOYEE", clerk.id))).toEqual([]);
    await expect(acknowledge(t.ctx("EMPLOYEE", clerk.id), guardsOnly.id)).rejects.toThrow(/doesn't apply/);
    expect(await rowOf(t, guardsOnly.id, clerk.id)).toBeUndefined();

    await expect(acknowledge(t.ctx("EMPLOYEE"), guardsOnly.id)).rejects.toThrow(/isn't linked/); // an unlinked login
    expect(await myPolicies(t.ctx("EMPLOYEE"))).toEqual([]);
    await expect(acknowledge(t.ctx("EMPLOYEE", guard.id), "ghost")).rejects.toThrow(/not found/);

    await setPolicyStatus(hr, guardsOnly.id, "ARCHIVED");
    await expect(acknowledge(t.ctx("EMPLOYEE", guard.id), guardsOnly.id)).rejects.toThrow(/archived/);
    expect(await myPolicies(t.ctx("EMPLOYEE", guard.id))).toEqual([]);
    await setPolicyStatus(hr, guardsOnly.id, "ACTIVE");
    await db.employee.update({ where: { id: guard.id }, data: { status: "RESIGNED" } });
    await expect(acknowledge(t.ctx("EMPLOYEE", guard.id), guardsOnly.id)).rejects.toThrow(/has left/);
  });

  it("isn't open until the policy takes effect", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct({ effectiveDate: day(10) }));
    const e = await staff(t, "Early");
    await expect(acknowledge(t.ctx("EMPLOYEE", e.id), p.id)).rejects.toThrow(/hasn't taken effect/);
    expect(await myPolicies(t.ctx("EMPLOYEE", e.id))).toEqual([]);
    const data = (await listPolicies(hr)).active.find((c) => c.policy.id === p.id)!;
    expect(data.current).toBeNull();
    expect(data.scheduled?.version).toBe(1);
  });

  it("is never carried out on someone's behalf by themselves, and HR's paper record needs a reference", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct());
    const e = await staff(t, "Paper");
    await expect(recordAcknowledgement(hr, p.id, e.id, "")).rejects.toThrow(/signed sheet/);
    await expect(recordAcknowledgement(t.ctx("AUDITOR"), p.id, e.id, "File HR/1")).rejects.toThrow();
    await expect(recordAcknowledgement(t.ctx("HR_ADMIN", e.id, 4), p.id, e.id, "File HR/1")).rejects.toThrow(/yourself/);
    const a = await recordAcknowledgement(hr, p.id, e.id, "Signed sheet, file HR/1");
    expect(a).toMatchObject({ method: "RECORDED", recordedBy: hr.name, note: "Signed sheet, file HR/1" });
    expect(await rowOf(t, p.id, e.id)).toMatchObject({ state: "ACKNOWLEDGED", method: "RECORDED" });
    await expect(recordAcknowledgement(hr, p.id, e.id, "File HR/1 again")).rejects.toThrow(/already been acknowledged/);
    await expect(acknowledge(t.ctx("EMPLOYEE", e.id), p.id)).rejects.toThrow(/already been acknowledged/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "POLICY_ACK_RECORDED" } })).toBe(1);
  });
});

describe("due dates and overdue", () => {
  it("counts the grace period from the later of the version and joining", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct({ effectiveDate: day(-30), graceDays: 14 }));
    const veteran = await staff(t, "Veteran");
    const newHire = await staff(t, "NewHire", { employed: day(-3) });
    const vet = (await rowOf(t, p.id, veteran.id))!;
    const nh = (await rowOf(t, p.id, newHire.id))!;
    expect(vet.state).toBe("OVERDUE"); // 30 days ago + 14 = 16 days ago
    expect(iso(vet.due)).toBe(day(-16));
    expect(nh.state).toBe("PENDING"); // 3 days ago + 14 = in 11 days
    expect(iso(nh.due)).toBe(day(11));
    const totals = (await getPolicy(hr, p.id))!.totals;
    expect(totals).toMatchObject({ applicable: 2, overdue: 1, pending: 1, acknowledged: 0 });
    await acknowledge(t.ctx("EMPLOYEE", veteran.id), p.id);
    expect((await getPolicy(hr, p.id))!.totals).toMatchObject({ overdue: 0, pending: 1, acknowledged: 1 });
  });
});

describe("versions", () => {
  it("asks everyone again for a new version, and a scheduled one waits for its date", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct({ effectiveDate: day(-60) }));
    const e = await staff(t, "Again");
    await acknowledge(t.ctx("EMPLOYEE", e.id), p.id);
    expect((await rowOf(t, p.id, e.id))!.state).toBe("ACKNOWLEDGED");

    await expect(publishVersion(hr, p.id, { body: "New text", changeSummary: "" })).rejects.toThrow();
    await expect(publishVersion(hr, p.id, { changeSummary: "Added a section", body: undefined })).rejects.toThrow(/text, a document reference/);
    await expect(publishVersion(hr, p.id, { body: "New text", changeSummary: "Added a section", effectiveDate: day(-90) })).rejects.toThrow(/can't take effect before version 1/);
    await expect(publishVersion(t.ctx("AUDITOR"), p.id, { body: "New text", changeSummary: "Added a section" })).rejects.toThrow();

    // scheduled: version 1 stays current and acknowledged until the date arrives
    const v2 = await publishVersion(hr, p.id, { body: "Version two text", changeSummary: "Added a social media rule", effectiveDate: day(5) });
    expect(v2.version).toBe(2);
    const sched = (await getPolicy(hr, p.id))!;
    expect(sched.current?.version).toBe(1);
    expect(sched.scheduled?.version).toBe(2);
    expect((await rowOf(t, p.id, e.id))!.state).toBe("ACKNOWLEDGED");
    expect((await myPolicies(t.ctx("EMPLOYEE", e.id)))[0].scheduled?.version).toBe(2);

    // the date arrives: version 2 is current and the old acknowledgement no longer counts
    await db.policyVersion.update({ where: { id: v2.id }, data: { effectiveDate: addDays(todayUtc(), -20) } });
    const now = (await getPolicy(hr, p.id))!;
    expect(now.current?.version).toBe(2);
    expect(now.versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await rowOf(t, p.id, e.id))).toMatchObject({ state: "OVERDUE" }); // 20 days ago + 14 grace
    expect((await myPolicies(t.ctx("EMPLOYEE", e.id)))[0].version.changeSummary).toBe("Added a social media rule");
    await acknowledge(t.ctx("EMPLOYEE", e.id), p.id);
    expect((await rowOf(t, p.id, e.id))!.state).toBe("ACKNOWLEDGED");
    expect(await db.policyAcknowledgement.count({ where: { employeeId: e.id } })).toBe(2); // v1's record is kept
    // published wording is never edited: version 1 still reads as it did
    expect((await db.policyVersion.findFirstOrThrow({ where: { policyId: p.id, version: 1 } })).body).toBe("Be honest. Be on time.");
  });

  it("can change who it applies to, and be archived and restored", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const p = await createPolicy(hr, conduct({ categoryId: t.guardId }));
    const clerk = await staff(t, "Clerk", { office: true });
    expect(await rowOf(t, p.id, clerk.id)).toBeUndefined();
    await updatePolicy(hr, p.id, { categoryId: undefined, title: p.title }); // blank = everyone
    expect(await rowOf(t, p.id, clerk.id)).toBeDefined();
    await updatePolicy(hr, p.id, { categoryId: t.guardId });
    expect(await rowOf(t, p.id, clerk.id)).toBeUndefined();
    await expect(updatePolicy(hr, p.id, { categoryId: "nope" })).rejects.toThrow(/category not found/);
    await expect(updatePolicy(hr, "ghost", { title: "Whatever" })).rejects.toThrow(/not found/);
    await expect(updatePolicy(t.ctx("AUDITOR"), p.id, { title: "Renamed" })).rejects.toThrow();
    const second = await createPolicy(hr, conduct({ title: "Another Policy" }));
    await expect(updatePolicy(hr, second.id, { title: p.title.toUpperCase() })).rejects.toThrow(/already a policy called/);

    await expect(setPolicyStatus(hr, p.id, "ACTIVE")).rejects.toThrow(/already active/);
    await setPolicyStatus(hr, p.id, "ARCHIVED");
    await expect(publishVersion(hr, p.id, { body: "x y z", changeSummary: "Cannot publish when archived" })).rejects.toThrow(/archived/);
    expect((await listPolicies(hr)).archived.map((x) => x.id)).toEqual([p.id]);
    expect((await listPolicies(hr)).active.map((c) => c.policy.id)).not.toContain(p.id);
    await setPolicyStatus(hr, p.id, "ACTIVE");
    expect((await listPolicies(hr)).active.map((c) => c.policy.id)).toContain(p.id);
  });
});

describe("privacy and tenancy", () => {
  it("keeps one organization's policies, and the employees list, to itself", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const p = await createPolicy(a.ctx("HR_ADMIN"), conduct());
    const e = await staff(a, "Insider");
    expect(await getPolicy(b.ctx("HR_ADMIN"), p.id)).toBeNull();
    expect((await listPolicies(b.ctx("HR_ADMIN"))).active).toEqual([]);
    await expect(acknowledge(b.ctx("EMPLOYEE", e.id), p.id)).rejects.toThrow(/not found/);
    await expect(recordAcknowledgement(b.ctx("HR_ADMIN"), p.id, e.id, "File 1")).rejects.toThrow(/not found/);
    await expect(publishVersion(b.ctx("HR_ADMIN"), p.id, { body: "x y z", changeSummary: "Not mine to change" })).rejects.toThrow(/not found/);
    await expect(getPolicy(a.ctx("OPERATIONS"), p.id)).rejects.toThrow();
    expect((await getPolicy(a.ctx("AUDITOR"), p.id))!.policy.id).toBe(p.id);
  });
});

describe("HR digest", () => {
  it("lists policies with overdue acknowledgements, and goes quiet when they're done", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${uid()}@pol.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const p = await createPolicy(hr, conduct({ title: "Overdue Policy", effectiveDate: day(-40) }));
    const a = await staff(t, "Ann");
    const b = await staff(t, "Bob");
    expect((await policyAttention(t.org.id, todayUtc()))[0]).toMatchObject({ overdue: 2, applicable: 2 });
    const d = await buildHrDigest(t.org.id);
    const sec = d.sections.find((s) => s.key === "policies")!;
    expect(sec.items[0]).toMatchObject({ text: "Overdue Policy — 2 of 2 overdue", path: `/hr/policies/${p.id}` });
    await acknowledge(t.ctx("EMPLOYEE", a.id), p.id);
    expect((await buildHrDigest(t.org.id)).sections.find((s) => s.key === "policies")!.items[0].text).toBe("Overdue Policy — 1 of 2 overdue");
    await recordAcknowledgement(hr, p.id, b.id, "Signed sheet HR/9");
    expect((await buildHrDigest(t.org.id)).sections.map((s) => s.key)).not.toContain("policies");
  });
});

describe("demo data", () => {
  it("seeds policies with a second version, and acknowledgements in every state", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const { active } = await listPolicies(hr);
    const code = active.find((c) => c.policy.title === "Code of Conduct")!;
    expect(code.current?.version).toBe(2);
    expect(code.totals.overdue).toBeGreaterThan(0);
    expect(code.totals.acknowledged).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThanOrEqual(3);
    const force = active.find((c) => c.policy.title === "Use of Force & Escort Procedures")!;
    expect(force.totals.applicable).toBeLessThan(code.totals.applicable); // guards only
    const paper = (await getPolicy(hr, active.find((c) => c.policy.title === "Data Protection Notice")!.policy.id))!.rows.filter((r) => r.method === "RECORDED");
    expect(paper.length).toBeGreaterThan(0);
  });
});
