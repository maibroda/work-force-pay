import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { JOB_MODULES, UNCONFIRMED, effectiveModule } from "@/lib/entitlements/entry-modules";
import { ensureSubscription } from "@/server/services/subscriptions";
import { entitledOrgs, orgEntitled, organizationsWithoutSubscription, setMode } from "@/server/services/entitlement-switch";
import { runRetentionForAllOrgs } from "@/server/services/retention";
import { runDigestForAllOrgs } from "@/server/services/reminders";
import { runDueReversalsForAllOrgs } from "@/server/services/journals";
import { generateDueForAllOrgs } from "@/server/services/recurring-journals";
import { isolatedOrg } from "../helpers";

/**
 * Step E3c of docs/plans/module-entitlements-e3.md: the scheduled jobs run for every company, so each must skip a company whose module is being enforced and was not bought.
 * Nothing here turns anything on for real: every test puts the switch back to OFF afterwards. (A job whose entry is still an unconfirmed guess would be held to the core;
 * the last three were confirmed by the founder on 2026-11-03, so none of the jobs is a guess any more apart from the core ones.)
 */
const platformOf = (orgId: string): Ctx => ({ userId: `${orgId}-su`, orgId, role: "SUPER_ADMIN", name: "Platform", email: "p@x.test", employeeId: null });

afterEach(async () => {
  await db.entitlementSwitch.deleteMany();
  vi.restoreAllMocks();
});

/** `a` has HR and the CRM on top of payroll, `b` has payroll only; every other company in the test database is given a subscription so that the switch may be turned on. */
async function twoCompanies() {
  const a = await isolatedOrg();
  const b = await isolatedOrg();
  const by = platformOf(a.org.id);
  await ensureSubscription(db, by, a.org.id, { planKey: "payroll_essentials", addOns: ["hr", "crm", "accounting"], reason: "test" });
  await ensureSubscription(db, by, b.org.id, { planKey: "payroll_essentials", reason: "test" });
  for (const o of await organizationsWithoutSubscription()) await ensureSubscription(db, by, o.id, { planKey: "payroll_essentials", reason: "test" });
  return { a, b, by };
}

describe("which companies a job runs for", () => {
  it("is every company while the module is OFF, even one that did not buy it (the state today)", async () => {
    const { a, b } = await twoCompanies();
    expect(await entitledOrgs([a.org.id, b.org.id], "hr-digest")).toEqual([a.org.id, b.org.id]);
    expect(await orgEntitled(b.org.id, "hr-digest")).toBe(true);
  });

  it("is only the companies that bought the module once it is ENFORCED, and a company with no subscription counts as having the core only", async () => {
    const { a, b, by } = await twoCompanies();
    await setMode(by, "hr", "ENFORCE", "Test");
    expect(await entitledOrgs([a.org.id, b.org.id], "hr-digest")).toEqual([a.org.id]);
    expect(await orgEntitled(b.org.id, "hr-digest")).toBe(false);
    expect(await orgEntitled(a.org.id, "hr-digest")).toBe(true);
    const later = await isolatedOrg(); // made after the switch, with no subscription
    expect(await entitledOrgs([later.org.id], "hr-digest")).toEqual([]);
    expect(await entitledOrgs([later.org.id], "sales-digest")).toEqual([later.org.id]); // the CRM is not being enforced
  });

  it("is every company in REPORT mode, and says which one it would have skipped, without naming the one that is fine", async () => {
    const { a, b, by } = await twoCompanies();
    await setMode(by, "hr", "REPORT", "Looking");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await entitledOrgs([a.org.id, b.org.id], "hr-digest")).toEqual([a.org.id, b.org.id]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("entitlement_would_refuse") && l.includes(b.org.id) && l.includes("hr-digest"))).toBe(true);
    expect(lines.some((l) => l.includes(a.org.id))).toBe(false);
  });

  it("never holds back the core (the audit-log jobs)", async () => {
    const { b, by } = await twoCompanies();
    await setMode(by, "accounting", "ENFORCE", "Test");
    await setMode(by, "payroll", "ENFORCE", "Test");
    for (const job of ["audit-heads", "audit-seal", "audit-verify"]) expect(await entitledOrgs([b.org.id], job), job).toEqual([b.org.id]);
  });

  it("holds back the three jobs the founder confirmed on 2026-11-03: journal reversals and recurring journals are Accounting, payroll reminders are Payroll", async () => {
    const { a, b, by } = await twoCompanies(); // a has accounting (an add-on) and payroll; b has payroll only
    expect(effectiveModule("job", "/api/cron/journal-reversals")).toBe("accounting");
    expect(effectiveModule("job", "/api/cron/recurring-journals")).toBe("accounting");
    expect(effectiveModule("job", "/api/cron/payroll-reminders")).toBe("payroll");
    for (const job of ["journal-reversals", "recurring-journals", "payroll-reminders"]) expect(UNCONFIRMED.has(`job /api/cron/${job}`), job).toBe(false);
    await setMode(by, "accounting", "ENFORCE", "Test");
    for (const job of ["journal-reversals", "recurring-journals"]) {
      expect(await entitledOrgs([a.org.id, b.org.id], job), job).toEqual([a.org.id]);
    }
    expect(await entitledOrgs([a.org.id, b.org.id], "payroll-reminders")).toEqual([a.org.id, b.org.id]); // payroll is not being enforced
    await setMode(by, "payroll", "ENFORCE", "Test");
    const later = await isolatedOrg(); // no subscription: the core only, so not entitled to payroll
    expect(await entitledOrgs([a.org.id, b.org.id, later.org.id], "payroll-reminders")).toEqual([a.org.id, b.org.id]);
  });

  it("refuses a job that does not exist, rather than letting it run for everyone by mistake", async () => {
    const { b } = await twoCompanies();
    await expect(entitledOrgs([b.org.id], "no-such-job")).rejects.toThrow(/no module declared/i);
  });
});

describe("the jobs themselves", () => {
  it("skip a company that did not buy the module: no result for it", async () => {
    const { a, b, by } = await twoCompanies();
    await setMode(by, "hr", "ENFORCE", "Test");
    const names = (rows: Array<{ organization: string }>) => rows.map((r) => r.organization);
    const digests = names(await runDigestForAllOrgs(new Date()));
    expect(digests).toContain(a.org.name);
    expect(digests).not.toContain(b.org.name);
    const retention = names(await runRetentionForAllOrgs(new Date()));
    expect(retention).toContain(a.org.name);
    expect(retention).not.toContain(b.org.name);
  });

  it("skip a company that did not buy Accounting: the recurring-journals and journal-reversals jobs have no result for it", async () => {
    const { a, b, by } = await twoCompanies();
    await setMode(by, "accounting", "ENFORCE", "Test");
    const names = (rows: Array<{ organization: string }>) => rows.map((r) => r.organization);
    const recurring = names(await generateDueForAllOrgs(new Date()));
    expect(recurring).toContain(a.org.name);
    expect(recurring).not.toContain(b.org.name);
    const reversals = names(await runDueReversalsForAllOrgs(new Date()));
    expect(reversals).toContain(a.org.name);
    expect(reversals).not.toContain(b.org.name);
  });

  it("run for every company while the switch is OFF", async () => {
    const { a, b } = await twoCompanies();
    const names = (await runDigestForAllOrgs(new Date())).map((r) => r.organization);
    expect(names).toEqual(expect.arrayContaining([a.org.name, b.org.name]));
    const journals = (await generateDueForAllOrgs(new Date())).map((r) => r.organization);
    expect(journals).toEqual(expect.arrayContaining([a.org.name, b.org.name]));
  });
});

describe("the wiring, so that a job cannot be quietly left out", () => {
  const ROOT = process.cwd();
  const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

  it("has every job that belongs to a module (confirmed or not) ask which companies it may run for, in a service it calls, with its own name", () => {
    for (const [route, module] of Object.entries(JOB_MODULES)) {
      if (module === "core") continue; // the audit log and the like are never held back
      const job = route.slice("/api/cron/".length);
      const routeSrc = read("src", "app", ...route.split("/").filter(Boolean), "route.ts");
      const services = [...routeSrc.matchAll(/from "@\/server\/services\/([a-z/-]+)"/g)].map((m) => m[1]).filter((s) => s !== "job-runs");
      expect(services.length, `${route} calls a service`).toBeGreaterThan(0);
      const asks = services.some((s) => {
        const file = path.join(ROOT, "src", "server", "services", `${s}.ts`);
        return fs.existsSync(file) && new RegExp(`(entitledOrgs|orgEntitled)\\([^;]{0,200}"${job}"`).test(fs.readFileSync(file, "utf8"));
      });
      expect(asks, `${route} (${module}) should call entitledOrgs/orgEntitled with "${job}" in ${services.join(", ")}`).toBe(true);
    }
  });
});
