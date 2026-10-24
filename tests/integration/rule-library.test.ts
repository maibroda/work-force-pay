import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau, onboardClient, updateEngagement } from "@/server/services/bureau";
import { getRelease, listReleases, proposeRelease, publishRelease, releasableRules, verifyRelease, withdrawRelease } from "@/server/services/rule-library";
import { createPensionRule, createTaxRuleVersion } from "@/server/services/statutory";
import { isolatedOrg, uid } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@rules.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

const v2 = (over: Record<string, unknown> = {}) => ({
  code: "NG-PAYE", name: "PAYE", version: "2027.1", effectiveFrom: "2027-01-01",
  bands: [{ lowerBound: 0, upperBound: 800000, rate: 0 }, { lowerBound: 800000, upperBound: null, rate: 18 }],
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }],
  exemptions: [{ code: "MIN", description: "Minimum wage", annualGrossCeiling: 840000 }],
  ...over,
});

/** A bureau with its master PAYE v1 and v2, the people who propose and verify, and two clients that were onboarded on v1. */
async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const hr = await person(t.org.id, "HR_ADMIN", "hr");
  const hr2 = await person(t.org.id, "HR_ADMIN", "hrtwo");
  const finance = await person(t.org.id, "FINANCE", "finance");
  await enableBureau(founder);
  await db.taxRule.create({
    data: {
      organizationId: t.org.id, code: "NG-PAYE", name: "PAYE", version: "2026.1", effectiveFrom: d("2026-01-01"),
      bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: 800000, rate: 0 }, { sortOrder: 2, lowerBound: 800000, upperBound: null, rate: 15 }] },
      reliefs: { create: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }] },
      exemptions: { create: [{ code: "MIN", description: "Minimum wage", annualGrossCeiling: 840000 }] },
    },
  });
  await db.pensionRule.create({ data: { organizationId: t.org.id, version: "v1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2020-01-01") } });
  await db.payrollRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  const onboard = (name: string) => onboardClient(founder, { name, code: `R${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 12 } as never).then((r) => r.client);
  const a = await onboard("Client A");
  const b = await onboard("Client B");
  // the new master version, created the usual way in the bureau's own tables
  const master2 = await createTaxRuleVersion(founder, v2() as never);
  return { t, founder, officer, hr, hr2, finance, a, b, master2, onboard };
}

const propose = (w: Awaited<ReturnType<typeof world>>) =>
  proposeRelease(w.officer, { kind: "TAX", ruleId: w.master2.id, summary: "Top rate raised to 18% from January 2027", source: "Finance Act 2026, s. 12" } as never);
const verifyBoth = async (w: Awaited<ReturnType<typeof world>>, id: string) => {
  await verifyRelease(w.hr, id, "Checked bands and rate against the Finance Act");
  return verifyRelease(w.finance, id, "Agrees with FIRS circular 2026/09");
};

describe("proposing and verifying", () => {
  it("needs a source and a reason, a rule that is the bureau's own, and only one release at a time", async () => {
    const w = await world();
    await expect(proposeRelease(w.officer, { kind: "TAX", ruleId: w.master2.id, summary: "short", source: "x" } as never)).rejects.toThrow();
    await expect(proposeRelease(w.hr, { kind: "TAX", ruleId: w.master2.id, summary: "Top rate raised to 18%", source: "Finance Act 2026" } as never)).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    const foreign = await db.pensionRule.create({ data: { organizationId: other.org.id, version: "x", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2020-01-01") } });
    await expect(proposeRelease(w.officer, { kind: "PENSION", ruleId: foreign.id, summary: "Rates for pension", source: "PRA 2014" } as never)).rejects.toThrow(/not in the bureau's own tables/);

    expect((await releasableRules(w.officer)).some((r) => r.id === w.master2.id)).toBe(true);
    const r = await propose(w);
    expect(r).toMatchObject({ status: "PROPOSED", kind: "TAX", version: "2027.1", proposedByUserId: w.officer.userId });
    expect(r.checksum).toMatch(/^[0-9a-f]{64}$/);
    await expect(propose(w)).rejects.toThrow(/already has a release/);
    expect((await releasableRules(w.officer)).some((x) => x.id === w.master2.id)).toBe(false);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "RULE_RELEASE_PROPOSE" } })).toBe(1);
  });

  it("takes one verification from HR and one from Finance, nobody twice, and only in those roles", async () => {
    const w = await world();
    const r = await propose(w);
    await expect(verifyRelease(w.hr, r.id, "short")).rejects.toThrow(/at least 10/);
    await expect(verifyRelease(w.officer, r.id, "I proposed this, trust me")).rejects.toThrow(/permission/);
    // the founder holds every permission but is neither HR nor Finance
    await expect(verifyRelease(w.founder, r.id, "Founder checking the rates")).rejects.toThrow(/HR and by Finance/);

    expect(await verifyRelease(w.hr, r.id, "Checked bands against the Finance Act")).toEqual({ verified: false });
    await expect(verifyRelease(w.hr2, r.id, "A second HR person agreeing")).rejects.toThrow(/HR has already verified/);
    expect((await db.ruleRelease.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PROPOSED");
    expect(await verifyRelease(w.finance, r.id, "Agrees with FIRS circular 2026/09")).toEqual({ verified: true });
    expect((await db.ruleRelease.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("VERIFIED");
    await expect(verifyRelease(w.hr2, r.id, "Verifying after it is done")).rejects.toThrow(/Only a proposed/);

    const list = await listReleases(w.officer);
    expect(list[0].verifications.map((v) => v.slot).sort()).toEqual(["FINANCE", "HR"]);
  });

  it("refuses to verify, or publish, a rule that was changed after it was proposed", async () => {
    const w = await world();
    const r = await propose(w);
    await verifyRelease(w.hr, r.id, "Checked bands against the Finance Act");
    // someone edits the master rate behind the process
    const band = await db.taxBand.findFirstOrThrow({ where: { taxRuleId: w.master2.id, sortOrder: 2 } });
    await db.taxBand.update({ where: { id: band.id }, data: { rate: 25 } });
    await expect(verifyRelease(w.finance, r.id, "Agrees with FIRS circular 2026/09")).rejects.toThrow(/no longer matches what was proposed/);
    expect((await getRelease(w.officer, r.id))?.intact).toBe(false);
    await expect(publishRelease(w.founder, r.id)).rejects.toThrow(/Only a rule release verified/);
    await withdrawRelease(w.officer, r.id, "Master rate was edited after proposal");
    expect((await db.ruleRelease.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("WITHDRAWN");
    await expect(verifyRelease(w.finance, r.id, "Verifying after withdrawal")).rejects.toThrow(/Only a proposed/);
  });
});

describe("publishing to clients", () => {
  it("won't publish before both sign-offs, then gives every live client the new version and end-dates the old one", async () => {
    const w = await world();
    const ended = await w.onboard("Client Gone");
    await updateEngagement(w.founder, ended.id, { package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 12, status: "ENDED" } as never);
    const r = await propose(w);
    await expect(publishRelease(w.officer, r.id)).rejects.toThrow(/verified by both HR and Finance/);
    await verifyRelease(w.hr, r.id, "Checked bands against the Finance Act");
    await expect(publishRelease(w.officer, r.id)).rejects.toThrow(/verified by both HR and Finance/);
    await verifyRelease(w.finance, r.id, "Agrees with FIRS circular 2026/09");
    await expect(publishRelease(w.hr, r.id)).rejects.toThrow(/permission/);

    const results = await publishRelease(w.officer, r.id);
    expect(results.map((x) => x.outcome)).toEqual(["PUBLISHED", "PUBLISHED"]);
    for (const c of [w.a, w.b]) {
      const rules = await db.taxRule.findMany({ where: { organizationId: c.id }, include: { bands: true }, orderBy: { effectiveFrom: "asc" } });
      expect(rules.map((x) => x.version)).toEqual(["2026.1", "2027.1"]);
      expect(day(rules[0].effectiveTo)).toBe("2026-12-31");
      expect(rules[1].effectiveTo).toBeNull();
      expect(rules[1].bands.map((b) => Number(b.rate)).sort((x, y) => x - y)).toEqual([0, 18]);
      const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: c.id, action: "RULE_PUBLISHED" } });
      expect(log.userName).toBe(w.officer.name);
      expect(JSON.stringify(log.newValue)).toContain("HR:");
    }
    expect(await db.rulePublication.count({ where: { releaseId: r.id, clientOrganizationId: ended.id } })).toBe(0); // an ended client is left alone
    const after = await db.ruleRelease.findUniqueOrThrow({ where: { id: r.id } });
    expect(after).toMatchObject({ status: "PUBLISHED", publishedBy: w.officer.name });
    await expect(publishRelease(w.officer, r.id)).rejects.toThrow(/Every client already has this release/);
    await expect(withdrawRelease(w.officer, r.id, "Changed my mind about it")).rejects.toThrow(/published release is not withdrawn/);
  });

  it("reports a client that can't take the rule and still gives it to the rest; a later client can be sent it", async () => {
    const w = await world();
    // client B has a rule of its own that starts after the new version (set directly: clients can't create these themselves)
    await db.taxRule.create({ data: { organizationId: w.b.id, code: "NG-PAYE", name: "PAYE", version: "custom", effectiveFrom: d("2027-06-01") } });
    const r = await propose(w);
    await verifyBoth(w, r.id);
    const results = await publishRelease(w.founder, r.id);
    expect(results.find((x) => x.clientId === w.a.id)?.outcome).toBe("PUBLISHED");
    const fail = results.find((x) => x.clientId === w.b.id)!;
    expect(fail.outcome).toBe("FAILED");
    expect(fail.message).toMatch(/starting on or after this date/);
    expect(await db.taxRule.count({ where: { organizationId: w.b.id, version: "2027.1" } })).toBe(0);
    expect(await db.auditLog.count({ where: { organizationId: w.b.id, action: "RULE_PUBLISH_FAILED" } })).toBe(1);

    // B's own later rule is removed; the release can be sent to B again, and a new client that already starts on it holds it
    await db.taxRule.deleteMany({ where: { organizationId: w.b.id, version: "custom" } });
    const c = await w.onboard("Client C");
    const again = await publishRelease(w.founder, r.id);
    expect(again.find((x) => x.clientId === w.b.id)?.outcome).toBe("PUBLISHED");
    expect(again.find((x) => x.clientId === c.id)?.outcome).toBe("ALREADY_HELD"); // onboarded after v2 was in the bureau's tables
    expect(await db.rulePublication.count({ where: { releaseId: r.id } })).toBe(3);
  });

  it("publishes pension and employer-contribution versions the same way", async () => {
    const w = await world();
    const p2 = await createPensionRule(w.founder, { version: "v2", employeeRate: 8, employerRate: 12, pensionableCodes: ["BASIC", "HOUSING"], effectiveFrom: "2027-01-01" });
    const r = await proposeRelease(w.officer, { kind: "PENSION", ruleId: p2.id, summary: "Employer rate to 12%", source: "Pension Reform Act amendment" } as never);
    await verifyBoth(w, r.id);
    await publishRelease(w.officer, r.id, [w.a.id]);
    const rules = await db.pensionRule.findMany({ where: { organizationId: w.a.id }, orderBy: { effectiveFrom: "asc" } });
    expect(rules.map((x) => [x.version, Number(x.employerRate)])).toEqual([["v1", 10], ["v2", 12]]);
    expect(day(rules[0].effectiveTo)).toBe("2026-12-31");
    expect(await db.pensionRule.count({ where: { organizationId: w.b.id } })).toBe(1); // only the named client
    expect((await getRelease(w.officer, r.id))?.pendingClients.map((x) => x.id)).toEqual([w.b.id]);

    const e = await db.employerCostRule.create({ data: { organizationId: w.t.org.id, version: "v2", itfPct: 1, nsitfPct: 1.5, effectiveFrom: d("2027-01-01") } });
    const re = await proposeRelease(w.officer, { kind: "EMPLOYER_COST", ruleId: e.id, summary: "NSITF to 1.5%", source: "NSITF notice 2026/3" } as never);
    await verifyBoth(w, re.id);
    await publishRelease(w.officer, re.id);
    expect((await db.employerCostRule.findMany({ where: { organizationId: w.b.id } })).map((x) => x.version).sort()).toEqual(["v1", "v2"]);
  });
});

describe("onboarding a client", () => {
  it("starts it on published rules and the bureau's baseline, never on a rule that is unverified or not yet in force", async () => {
    const w = await world();
    // master v2 (2027) is unreleased: a client onboarded now must not get it, whatever the date it takes effect
    const early = await w.onboard("Early Client");
    const earlyRules = await db.taxRule.findMany({ where: { organizationId: early.id } });
    expect(earlyRules.map((x) => x.version)).toEqual(expect.not.arrayContaining(["2027.1"]));
    expect(earlyRules.map((x) => x.version)).toContain("2026.1");

    const r = await propose(w);
    await verifyRelease(w.hr, r.id, "Checked bands against the Finance Act");
    expect((await db.taxRule.count({ where: { organizationId: (await w.onboard("Mid Client")).id, version: "2027.1" } }))).toBe(0); // proposed and half verified is not enough
    await verifyRelease(w.finance, r.id, "Agrees with FIRS circular 2026/09");
    await publishRelease(w.officer, r.id);
    const late = await w.onboard("Late Client");
    expect(await db.taxRule.count({ where: { organizationId: late.id, version: "2027.1" } })).toBe(1); // published: yes
  });
});

describe("clients and the database", () => {
  it("stop clients changing PAYE or pension rules themselves", async () => {
    const w = await world();
    const clientAdmin = await person(w.a.id, "COMPANY_ADMIN", "clientadmin");
    await expect(createTaxRuleVersion(clientAdmin, v2({ version: "mine" }) as never)).rejects.toThrow(/published by .* from its rule library/);
    await expect(createPensionRule(clientAdmin, { version: "mine", employeeRate: 1, employerRate: 1, pensionableCodes: ["BASIC"], effectiveFrom: "2027-01-01" })).rejects.toThrow(/Pension rules for this client are published by/);
    // the bureau's own tables are unaffected
    await createPensionRule(w.founder, { version: "bureau-own", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: "2028-01-01" });
  });

  it("refuses changes to a release, a verification or a publication record, whatever the application does", async () => {
    const w = await world();
    const r = await propose(w);
    // verifying as the proposer, in the wrong role, or of different content
    await expect(db.ruleVerification.create({ data: { releaseId: r.id, slot: "HR", verifierName: "x", verifierUserId: w.officer.userId, note: "n".repeat(12), checksum: r.checksum } })).rejects.toThrow(/Role|role|someone else|HR verification/);
    await expect(db.ruleVerification.create({ data: { releaseId: r.id, slot: "FINANCE", verifierName: "x", verifierUserId: w.hr.userId, note: "n".repeat(12), checksum: r.checksum } })).rejects.toThrow(/Finance|FINANCE verification has to come/);
    await expect(db.ruleVerification.create({ data: { releaseId: r.id, slot: "HR", verifierName: "x", verifierUserId: w.hr.userId, note: "n".repeat(12), checksum: "0".repeat(64) } })).rejects.toThrow(/changed after it was proposed/);
    // moving to verified without both sign-offs, changing what it covers, deleting
    await expect(db.ruleRelease.update({ where: { id: r.id }, data: { status: "VERIFIED" } })).rejects.toThrow(/needs both an HR and a Finance/);
    await expect(db.ruleRelease.update({ where: { id: r.id }, data: { checksum: "1".repeat(64) } })).rejects.toThrow(/cannot be changed/);
    await expect(db.ruleRelease.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/);
    await verifyBoth(w, r.id);
    const v = await db.ruleVerification.findFirstOrThrow({ where: { releaseId: r.id } });
    await expect(db.ruleVerification.update({ where: { id: v.id }, data: { note: "rewritten history" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.ruleVerification.delete({ where: { id: v.id } })).rejects.toThrow(/cannot be changed or deleted/);
    // a publication needs a published release
    await expect(db.rulePublication.create({ data: { releaseId: r.id, clientOrganizationId: w.a.id, outcome: "PUBLISHED", publishedBy: "x" } })).rejects.toThrow(/verified and published/);
    await expect(db.ruleRelease.update({ where: { id: r.id }, data: { status: "PUBLISHED" } })).rejects.toThrow(/Only a verified rule release can be published/);
    await publishRelease(w.officer, r.id);
    const p = await db.rulePublication.findFirstOrThrow({ where: { releaseId: r.id } });
    await expect(db.rulePublication.update({ where: { id: p.id }, data: { outcome: "FAILED" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.ruleRelease.update({ where: { id: r.id }, data: { status: "WITHDRAWN" } })).rejects.toThrow(/cannot change status/);
  });
});
