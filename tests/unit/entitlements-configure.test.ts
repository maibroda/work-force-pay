import { describe, expect, it } from "vitest";
import { MODULES, PLANS, type ModuleKey, type PlanKey } from "@/lib/entitlements/catalogue";
import { QUESTIONS, configureClient, type Answers, type QuestionKey } from "@/lib/entitlements/configure";
import { checkPlan, planModules } from "@/lib/entitlements/resolve";

/**
 * Step E4a of docs/plans/module-entitlements-e4.md: a salesperson's answers about a prospect become a blueprint (plan, add-ons, reasons, notes, limits). Pure: no database, no
 * prices. The questions and the plan rule are the founder's, accepted on 2026-11-03 from docs/plans/module-entitlements-e4-questionnaire-draft.md; the four worked prospects
 * below are the ones in that draft, so what the founder read is what is tested.
 */
const ask = (wants: QuestionKey[], over: Partial<Answers> = {}): Answers => ({ employees: 120, crmUsers: null, wants: Object.fromEntries(wants.map((w) => [w, true])), ...over });
const keysOf = (xs: readonly ModuleKey[]) => [...xs];

describe("the questions", () => {
  it("are twelve yes-or-no questions, each bringing in one module that exists and is built (or partly built), never the core and never a planned one", () => {
    expect(QUESTIONS).toHaveLength(12);
    expect(new Set(QUESTIONS.map((q) => q.key)).size).toBe(12);
    expect(new Set(QUESTIONS.map((q) => q.module)).size).toBe(12);
    for (const q of QUESTIONS) {
      expect(MODULES[q.module], q.key).toBeDefined();
      expect(q.module, q.key).not.toBe("core");
      expect(MODULES[q.module].status, `${q.key} is planned: it would sell what does not exist`).not.toBe("planned");
      expect(q.ask.length, q.key).toBeGreaterThan(10);
    }
    for (const planned of ["production_pay", "service_charge_pay", "integrations"]) expect(QUESTIONS.map((q) => q.module)).not.toContain(planned);
  });
});

describe("the four prospects in the draft the founder read", () => {
  it("A: payroll for 120 staff who should see their own payslips -> HR + Payroll (a tie on 1, settled by fewer add-ons), with Payroll Core plus Self-service as the runner-up", () => {
    const r = configureClient(ask(["payroll", "self_service"]));
    expect(r.ok).toBe(true);
    expect(r.modules).toEqual(["core", "payroll", "self_service"]);
    expect(r.proposed).toMatchObject({ planKey: "hr_payroll", planName: "HR + Payroll", addOns: [], unrequested: ["hr"] });
    expect(r.runnerUp).toMatchObject({ planKey: "payroll_essentials", planName: "Payroll Core", addOns: ["self_service"], unrequested: [] });
    expect(r.limits).toEqual({ employeeLimit: 120, crmUserLimit: null });
    expect(r.reasons).toEqual([]);
  });

  it("B: a guard company that deploys staff, runs payroll and invoices -> Payroll Core plus Contracts and deployment and Client billing", () => {
    const r = configureClient(ask(["payroll", "contracts_deployment", "client_billing"]));
    expect(r.modules).toEqual(["core", "payroll", "contracts_deployment", "client_billing"]);
    expect(r.proposed).toMatchObject({ planKey: "payroll_essentials", addOns: ["contracts_deployment", "client_billing"], unrequested: [] });
    expect(r.reasons).toEqual([]);
  });

  it("C: a firm that only manages prospects and clients -> the CRM plan exactly, with the sales users recorded as the limit", () => {
    const r = configureClient(ask(["crm"], { crmUsers: 5 }));
    expect(r.proposed).toMatchObject({ planKey: "crm", addOns: [], unrequested: [] });
    expect(r.runnerUp).toMatchObject({ planKey: "custom", addOns: ["crm"] });
    expect(r.limits).toEqual({ employeeLimit: 120, crmUserLimit: 5 });
  });

  it("D: payroll, clients approve it in a portal, books kept in the app -> Payroll Core plus Accounting and Client portal", () => {
    const r = configureClient(ask(["payroll", "client_portal", "accounting"]));
    expect(r.modules).toEqual(["core", "payroll", "accounting", "client_portal"]);
    expect(r.proposed).toMatchObject({ planKey: "payroll_essentials", addOns: ["accounting", "client_portal"] });
  });
});

describe("what the rules add, and the reasons given in words", () => {
  it("adds what a wanted module needs and says why, in words a salesperson can repeat, without ever mentioning the core", () => {
    const r = configureClient(ask(["payables_procurement"]));
    expect(r.modules).toEqual(["core", "accounting", "payables_procurement"]);
    expect(r.reasons.map((x) => x.because)).toEqual(["Payables and procurement needs Accounting, so Accounting was added."]);
    expect(r.proposed).toMatchObject({ planKey: "custom", addOns: ["accounting", "payables_procurement"] });
    expect(JSON.stringify(r)).not.toMatch(/Core platform was added/);
  });

  it("settles an either-or need and says so: client billing alone brings in Contracts and deployment, and the CRM if the prospect asked for it", () => {
    const alone = configureClient(ask(["client_billing"]));
    expect(alone.modules).toContain("contracts_deployment");
    expect(alone.reasons[0].because).toMatch(/Client billing needs one of .*Contracts & deployment was added/);
    const withCrm = configureClient(ask(["client_billing", "crm"], { crmUsers: 3 }));
    expect(withCrm.modules).not.toContain("contracts_deployment");
    expect(withCrm.reasons).toEqual([]);
  });

  it("proposes the Custom plan with the add-ons when no named plan is closer", () => {
    const r = configureClient(ask(["inventory"]));
    expect(r.proposed).toMatchObject({ planKey: "custom", addOns: ["inventory"], unrequested: [] });
  });

  it("says in plain words which wanted modules are only partly built, so what the client is told stays honest", () => {
    const r = configureClient(ask(["payroll", "time_attendance", "self_service"]));
    expect(r.notes).toContain("Time & attendance is only partly built: Work register, attendance and rosters exist; clocking does not.");
    expect(r.notes).toContain("Employee self-service is only partly built: The employee's own pages exist; SMS and WhatsApp payslips do not.");
    expect(configureClient(ask(["payroll"])).notes).toEqual([]);
  });
});

describe("answers that cannot be used", () => {
  it("refuses, in plain words and without a proposal, an employee count that is not a whole number of 1 or more", () => {
    for (const employees of [0, -3, 2.5, Number.NaN]) {
      const r = configureClient(ask(["payroll"], { employees }));
      expect(r.ok, String(employees)).toBe(false);
      expect(r.proposed).toBeNull();
      expect(r.problems.join(" ")).toMatch(/employees/i);
    }
  });

  it("asks how many sales users when the CRM is wanted, and for at least one thing the client needs", () => {
    expect(configureClient(ask(["crm"], { crmUsers: null })).problems.join(" ")).toMatch(/sales users/i);
    expect(configureClient(ask(["crm"], { crmUsers: 0 })).ok).toBe(false);
    const nothing = configureClient(ask([]));
    expect(nothing.ok).toBe(false);
    expect(nothing.problems.join(" ")).toMatch(/at least one/i);
  });

  it("refuses a question that does not exist, and a planned module offered as one, rather than quietly ignoring it", () => {
    const r = configureClient({ employees: 50, crmUsers: null, wants: { payroll: true, teleportation: true, production_pay: true } as never });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/teleportation/);
    expect(r.problems.join(" ")).toMatch(/production_pay/);
  });

  it("ignores a crm user count when the CRM is not wanted (no limit is invented)", () => {
    expect(configureClient(ask(["payroll"], { crmUsers: 9 })).limits.crmUserLimit).toBeNull();
  });
});

describe("for every possible set of answers", () => {
  const all = QUESTIONS.map((q) => q.key);
  const combos: QuestionKey[][] = [];
  for (let mask = 1; mask < 1 << all.length; mask++) combos.push(all.filter((_, i) => mask & (1 << i)));

  it("gives a complete blueprint that holds together, sells nothing planned, never lists the core as an add-on, and is the same every time", () => {
    for (const wants of combos) {
      const a = ask(wants, { employees: 50, crmUsers: 3 });
      const r = configureClient(a);
      const label = wants.join("+");
      expect(r.ok, label).toBe(true);
      expect(configureClient(a), label).toEqual(r); // deterministic
      expect(r.modules[0], label).toBe("core");
      for (const m of r.modules) expect(MODULES[m].status, `${label}: ${m}`).not.toBe("planned");
      const p = r.proposed!;
      expect(p.addOns, label).not.toContain("core");
      expect(checkPlan(p.planKey, p.addOns).ok, `${label}: ${p.planKey} + ${p.addOns.join(",")}`).toBe(true);
      // the plan plus its add-ons covers everything the blueprint needs, and nothing planned slipped in
      const have = new Set<ModuleKey>([...planModules(p.planKey), ...p.addOns]);
      for (const m of r.modules) expect(have.has(m), `${label}: ${m} is not covered`).toBe(true);
      expect(keysOf(p.unrequested).sort(), label).toEqual([...have].filter((m) => !r.modules.includes(m)).sort());
    }
  });

  it("proposes the plan with the fewest add-ons plus unasked modules, and on a tie the one with fewer add-ons (the founder's rule), and the runner-up is the next best", () => {
    const score = (plan: PlanKey, needed: ModuleKey[]) => {
      const inPlan = new Set(planModules(plan));
      const addOns = needed.filter((m) => !inPlan.has(m)).length;
      const unasked = planModules(plan).filter((m) => !needed.includes(m)).length;
      return { total: addOns + unasked, addOns };
    };
    const order = Object.keys(PLANS) as PlanKey[];
    for (const wants of combos) {
      const r = configureClient(ask(wants, { employees: 50, crmUsers: 3 }));
      const ranked = order.map((k, i) => ({ k, i, ...score(k, r.modules) })).sort((x, y) => x.total - y.total || x.addOns - y.addOns || x.i - y.i);
      expect(r.proposed!.planKey, wants.join("+")).toBe(ranked[0].k);
      expect(r.runnerUp?.planKey, wants.join("+")).toBe(ranked[1]?.k);
    }
  });

  it("does not change its input", () => {
    const a = ask(["payroll", "hr"]);
    const before = JSON.stringify(a);
    configureClient(a);
    expect(JSON.stringify(a)).toBe(before);
  });
});
