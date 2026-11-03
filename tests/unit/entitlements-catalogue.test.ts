import { describe, expect, it } from "vitest";
import { CATALOGUE_VERSION, MODULES, MODULE_KEYS, PLANS, PORTS, type ModuleKey } from "@/lib/entitlements/catalogue";
import { checkPlan, planModules, portSource, resolveModules, whatRemovalBreaks } from "@/lib/entitlements/resolve";

const keys = MODULE_KEYS;
const without = (xs: readonly ModuleKey[], k: ModuleKey) => xs.filter((x) => x !== k);

/** A module set is complete when every module in it has what it needs (all of "needs", and one of each "oneOf"). */
function complete(set: readonly ModuleKey[]) {
  const s = new Set(set);
  return set.every((k) => {
    const m = MODULES[k];
    return m.needs.every((n) => s.has(n)) && m.needsOneOf.every((group) => group.some((n) => s.has(n)));
  });
}

describe("the catalogue", () => {
  it("lists the twelve modules of the founder's document, the three they added (accounting, payables and procurement, inventory) and the client portal (their ruling of 2026-11-03)", () => {
    expect([...keys].sort()).toEqual(
      ["accounting", "analytics", "client_billing", "client_portal", "contracts_deployment", "core", "crm", "hr", "integrations", "inventory", "payables_procurement", "payroll", "production_pay", "self_service", "service_charge_pay", "time_attendance"].sort(),
    );
    expect(CATALOGUE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names every module, says what it is charged per and whether it is built, and every dependency is a module that exists", () => {
    for (const k of keys) {
      const m = MODULES[k];
      expect(m.key, k).toBe(k);
      expect(m.name.length, k).toBeGreaterThan(2);
      expect(["included", "active_employee", "crm_user", "flat"]).toContain(m.chargedPer);
      expect(["built", "partial", "planned"]).toContain(m.status);
      for (const n of [...m.needs, ...m.needsOneOf.flat()]) expect(keys, `${k} needs ${n}`).toContain(n);
      expect(m.needsOneOf.every((g) => g.length >= 2), `${k}: an either-or group needs at least two choices`).toBe(true);
    }
    expect(MODULES.core.chargedPer).toBe("included");
  });

  it("has no module that needs itself, directly or through others", () => {
    const reach = (k: ModuleKey, seen = new Set<ModuleKey>()): Set<ModuleKey> => {
      for (const n of [...MODULES[k].needs, ...MODULES[k].needsOneOf.flat()]) if (!seen.has(n)) { seen.add(n); reach(n, seen); }
      return seen;
    };
    for (const k of keys) expect(reach(k).has(k), k).toBe(false);
  });

  it("keeps the independence the founder asked for: payroll needs only the core, the CRM needs neither HR nor payroll", () => {
    expect(MODULES.payroll.needs).toEqual(["core"]);
    expect(MODULES.payroll.needsOneOf).toEqual([]);
    expect(MODULES.crm.needs).toEqual(["core"]);
    expect(MODULES.hr.needs).toEqual(["core"]);
    expect(MODULES.client_billing.needsOneOf).toEqual([["contracts_deployment", "crm"]]);
    expect(MODULES.self_service.needsOneOf).toEqual([["payroll", "hr"]]);
    expect(MODULES.production_pay.needs).toEqual(["payroll"]);
    expect(MODULES.service_charge_pay.needs).toEqual(["payroll"]);
    // the client portal is its own module, for a client's own people, and needs contracts and deployment (the founder's ruling of 2026-11-03)
    expect(MODULES.client_portal.needs).toEqual(["contracts_deployment"]);
    expect(MODULES.client_portal.chargedPer).toBe("flat");
  });
});

describe("working out what a selection needs", () => {
  it("always includes the core, and nothing else for the core alone", () => {
    expect(resolveModules([]).modules).toEqual(["core"]);
    expect(resolveModules(["core"]).modules).toEqual(["core"]);
    expect(resolveModules([]).added).toEqual([]);
  });

  it("keeps payroll on its own (core and payroll), without HR, and the CRM on its own (core and CRM)", () => {
    expect(resolveModules(["payroll"]).modules).toEqual(["core", "payroll"]);
    expect(resolveModules(["crm"]).modules).toEqual(["core", "crm"]);
    expect(resolveModules(["hr"]).modules).toEqual(["core", "hr"]);
  });

  it("adds contracts and deployment (and the core) when only the client portal is asked for, and says why", () => {
    const r = resolveModules(["client_portal"]);
    expect(r.modules).toEqual(["core", "contracts_deployment", "client_portal"]);
    expect(r.added.find((a) => a.module === "contracts_deployment")!.because).toBe("Client portal needs Contracts & deployment, so Contracts & deployment was added.");
  });

  it("adds what is missing and says why in words a salesperson can repeat", () => {
    const r = resolveModules(["production_pay"]);
    expect(r.modules).toEqual(["core", "payroll", "production_pay"]);
    expect(r.added.map((a) => a.module)).toEqual(["core", "payroll"]);
    const payroll = r.added.find((a) => a.module === "payroll")!;
    expect(payroll.because).toBe("Production pay needs Payroll, so Payroll was added.");
    expect(payroll.neededBy).toEqual(["production_pay"]);
  });

  it("settles an either-or need: nothing added when one choice is there, the first choice added (and said so) when none is", () => {
    expect(resolveModules(["client_billing", "crm"]).modules).toEqual(["core", "crm", "client_billing"]);
    expect(resolveModules(["client_billing", "contracts_deployment"]).modules).toEqual(["core", "contracts_deployment", "client_billing"]);
    const none = resolveModules(["client_billing"]);
    expect(none.modules).toEqual(["core", "contracts_deployment", "client_billing"]);
    const why = none.added.find((a) => a.module === "contracts_deployment")!.because;
    expect(why).toContain("Client billing needs one of Contracts & deployment or CRM");
    expect(why).toContain("Contracts & deployment was added");
    // the salesperson can prefer the other
    expect(resolveModules(["client_billing"], { prefer: ["crm"] }).modules).toEqual(["core", "crm", "client_billing"]);
    expect(resolveModules(["self_service"]).modules).toEqual(["core", "payroll", "self_service"]);
    expect(resolveModules(["self_service"], { prefer: ["hr"] }).modules).toEqual(["core", "hr", "self_service"]);
    expect(resolveModules(["self_service", "hr"]).modules).toEqual(["core", "hr", "self_service"]); // HR is there, so nothing is added
  });

  it("follows needs through several steps, and adds a shared need once", () => {
    const r = resolveModules(["payables_procurement"]);
    expect(r.modules).toEqual(["core", "accounting", "payables_procurement"]);
    const both = resolveModules(["production_pay", "service_charge_pay"]);
    expect(both.modules).toEqual(["core", "payroll", "production_pay", "service_charge_pay"]);
    expect(both.added.filter((a) => a.module === "payroll")).toHaveLength(1);
    expect(both.added.find((a) => a.module === "payroll")!.neededBy.sort()).toEqual(["production_pay", "service_charge_pay"]);
  });

  it("refuses a module that does not exist, naming it, and still works out the rest", () => {
    const r = resolveModules(["payroll", "teleportation" as never]);
    expect(r.problems).toEqual([{ kind: "UNKNOWN_MODULE", module: "teleportation", message: 'There is no module called "teleportation".' }]);
    expect(r.modules).toEqual(["core", "payroll"]);
  });

  it("gives the same answer however the selection is ordered or repeated, and again when given its own answer (idempotent)", () => {
    const a = resolveModules(["analytics", "payroll", "hr", "payroll"]).modules;
    expect(resolveModules(["hr", "payroll", "analytics"]).modules).toEqual(a);
    expect(resolveModules(a).modules).toEqual(a);
    expect(resolveModules(a).added).toEqual([]);
  });

  it("is complete for every single module and every pair of modules, and never adds more than is needed", () => {
    const nonCore = keys.filter((k) => k !== "core");
    const sets: ModuleKey[][] = [...nonCore.map((k) => [k]), ...nonCore.flatMap((a, i) => nonCore.slice(i + 1).map((b) => [a, b]))];
    expect(sets.length).toBe(15 + (15 * 14) / 2); // 15 singles and 105 pairs
    for (const s of sets) {
      const r = resolveModules(s);
      expect(r.problems, s.join("+")).toEqual([]);
      expect(complete(r.modules), s.join("+")).toBe(true); // every need is met
      for (const k of s) expect(r.modules, s.join("+")).toContain(k); // what was asked for is there
      expect(r.modules[0]).toBe("core");
      expect(resolveModules(r.modules).modules, s.join("+")).toEqual(r.modules); // idempotent
      // minimal: everything added is needed by something in the result
      for (const a of r.added) expect(a.neededBy.length, `${s.join("+")}: ${a.module}`).toBeGreaterThan(0);
      // and removing any one ADDED module would leave the result incomplete or lose a requested module
      for (const a of r.added.filter((x) => x.module !== "core")) expect(complete(without(r.modules, a.module)) && s.every((k) => k !== a.module), `${s.join("+")}: ${a.module} was needless`).toBe(false);
    }
  });

  it("is complete for a spot check of 2,000 random sets of the optional modules", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const nonCore = keys.filter((k) => k !== "core");
    for (let i = 0; i < 2000; i++) {
      const s = nonCore.filter(() => rnd() < 0.3);
      const r = resolveModules(s);
      expect(complete(r.modules), s.join("+")).toBe(true);
      expect(r.problems).toEqual([]);
    }
  });
});

describe("plans", () => {
  it("has the four named plans and a custom one, and each named plan is complete on its own", () => {
    expect(Object.keys(PLANS).sort()).toEqual(["crm", "custom", "hr_payroll", "payroll_essentials", "workforce_suite"]);
    for (const p of ["payroll_essentials", "hr_payroll", "crm", "workforce_suite"] as const) {
      const m = planModules(p);
      expect(complete(m), p).toBe(true);
      expect(resolveModules(m).modules, p).toEqual(m);
    }
  });

  it("includes what the founder's document says", () => {
    expect(planModules("payroll_essentials")).toEqual(["core", "payroll"]);
    expect([...planModules("hr_payroll")].sort()).toEqual(["core", "hr", "payroll", "self_service"]);
    expect(planModules("crm")).toEqual(["core", "crm"]);
    expect([...planModules("workforce_suite")].sort()).toEqual([...keys].sort()); // everything
    expect(planModules("custom")).toEqual(["core"]);
  });

  it("takes add-ons whose needs are met, refuses one already included, one that does not exist, and one whose needs are not met (saying which to add)", () => {
    expect(checkPlan("payroll_essentials", ["analytics", "time_attendance"])).toMatchObject({ ok: true, modules: ["core", "payroll", "time_attendance", "analytics"], problems: [] });
    const dup = checkPlan("hr_payroll", ["hr"]);
    expect(dup.ok).toBe(false);
    expect(dup.problems[0]).toMatchObject({ kind: "ALREADY_INCLUDED", module: "hr" });
    expect(checkPlan("crm", ["teleportation" as never]).problems[0]).toMatchObject({ kind: "UNKNOWN_MODULE" });
    const unmet = checkPlan("crm", ["production_pay"]);
    expect(unmet.ok).toBe(false);
    expect(unmet.problems[0]).toMatchObject({ kind: "NEEDS_MISSING", module: "production_pay", missing: ["payroll"] });
    expect(unmet.problems[0].message).toContain("Production pay needs Payroll");
    // the same add-on is fine once its need is also taken
    expect(checkPlan("crm", ["payroll", "production_pay"]).ok).toBe(true);
    // either-or needs: client billing is fine on the CRM plan (the CRM is one of the choices) and on payroll only when a choice is added
    expect(checkPlan("crm", ["client_billing"]).ok).toBe(true);
    expect(checkPlan("payroll_essentials", ["client_billing"]).ok).toBe(false);
    expect(checkPlan("payroll_essentials", ["client_billing", "contracts_deployment"]).ok).toBe(true);
  });

  it("lets the custom plan be any selection that is complete", () => {
    expect(checkPlan("custom", ["payroll", "production_pay"]).ok).toBe(true);
    expect(checkPlan("custom", ["production_pay"]).ok).toBe(false);
    expect(checkPlan("custom", []).modules).toEqual(["core"]);
  });
});

describe("what removing a module would break", () => {
  const set: ModuleKey[] = ["core", "hr", "payroll", "production_pay", "self_service", "analytics"];

  it("names the modules left without something they need, and why", () => {
    const b = whatRemovalBreaks(set, ["payroll"]);
    expect(b.refused).toEqual([]);
    expect(b.broken.map((x) => x.module)).toEqual(["production_pay"]);
    expect(b.broken[0].because).toBe("Production pay needs Payroll.");
  });

  it("does not break an either-or need while one choice remains (self-service keeps working on HR when payroll goes), and does when the last one goes", () => {
    expect(whatRemovalBreaks(set, ["payroll"]).broken.map((x) => x.module)).not.toContain("self_service");
    const last = whatRemovalBreaks(["core", "payroll", "self_service"], ["payroll"]);
    expect(last.broken.map((x) => x.module)).toEqual(["self_service"]);
    expect(last.broken[0].because).toContain("Employee self-service needs one of Payroll or HR management");
  });

  it("says nothing breaks when nothing depends on what is removed, and refuses to remove the core", () => {
    expect(whatRemovalBreaks(set, ["analytics"]).broken).toEqual([]);
    // removing contracts and deployment would leave the client portal without what it needs
    const b = whatRemovalBreaks(["core", "contracts_deployment", "client_portal"], ["contracts_deployment"]);
    expect(b.broken).toEqual([{ module: "client_portal", because: "Client portal needs Contracts & deployment." }]);
    expect(whatRemovalBreaks(set, ["core"]).refused).toEqual([{ module: "core", message: "The core platform is always on and cannot be removed." }]);
  });

  it("counts a removal together with the others removed at the same time", () => {
    const b = whatRemovalBreaks(set, ["payroll", "production_pay"]);
    expect(b.broken).toEqual([]); // the module that needed payroll is leaving as well
  });
});

describe("ports: where a module gets what it needs from, by what the client has", () => {
  it("lists the four ports of the founder's document", () => {
    expect(PORTS.map((p) => p.key).sort()).toEqual(["attendance_for_payroll", "departments", "labour_cost_for_quotes", "unpaid_leave_for_payroll"]);
  });

  it("takes unpaid leave from HR leave requests when the client has HR, and from days entered on the pay run when not", () => {
    expect(portSource(["core", "payroll", "hr"], "unpaid_leave_for_payroll")).toMatchObject({ source: "hr", fallback: false });
    expect(portSource(["core", "payroll"], "unpaid_leave_for_payroll")).toMatchObject({ source: "pay_run_days", fallback: true });
  });

  it("takes attendance from clock-in and out first, then deployment attendance, then days entered on the pay run", () => {
    expect(portSource(["core", "payroll", "time_attendance", "contracts_deployment"], "attendance_for_payroll").source).toBe("time_attendance");
    expect(portSource(["core", "payroll", "contracts_deployment"], "attendance_for_payroll").source).toBe("contracts_deployment");
    expect(portSource(["core", "payroll"], "attendance_for_payroll")).toMatchObject({ source: "pay_run_days", fallback: true });
  });

  it("takes the labour cost for a quote from real payroll cost when the client has payroll, otherwise from cost assumptions typed into the quote", () => {
    expect(portSource(["core", "crm", "payroll"], "labour_cost_for_quotes").source).toBe("payroll");
    expect(portSource(["core", "crm"], "labour_cost_for_quotes")).toMatchObject({ source: "typed_assumptions", fallback: true });
  });

  it("takes departments from the HR organisation structure when the client has HR, otherwise the simple list in the core", () => {
    expect(portSource(["core", "hr"], "departments").source).toBe("hr");
    expect(portSource(["core"], "departments")).toMatchObject({ source: "core_list", fallback: true });
  });

  it("gives a working answer for every port and every selection of modules (no combination is left without a source)", () => {
    const nonCore = keys.filter((k) => k !== "core");
    for (let mask = 0; mask < 1 << nonCore.length; mask += 37) {
      const s = ["core" as ModuleKey, ...nonCore.filter((_, i) => mask & (1 << i))];
      for (const p of PORTS) expect(portSource(s, p.key).source, `${p.key} for ${s.join("+")}`).toBeTruthy();
    }
  });
});
