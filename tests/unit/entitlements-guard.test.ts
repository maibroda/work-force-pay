import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { MODULES, type ModuleKey } from "@/lib/entitlements/catalogue";
import { API_MODULES } from "@/lib/entitlements/entry-modules";
import { decide, pageRouteFor, refusalMessage, type Entitlements } from "@/lib/entitlements/guard";
import { discoverPages } from "../../scripts/routes";

/**
 * Step E3a of docs/plans/module-entitlements-e3.md: the guards. They are wired into pages, server actions and API routes, but nothing gives a signed-in person an
 * `entitlements` setting yet, so every company is allowed everything. These tests show what the guards WOULD do the day it is switched on.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const ent = (modules: ModuleKey[] | null, modes: Entitlements["modes"] = {}): Entitlements => ({ modules, modes });
const everyModule = Object.keys(MODULES) as ModuleKey[];

describe("what a company with some modules may reach", () => {
  it("allows everything when nothing has been loaded for the request (the state today)", () => {
    for (const m of [...everyModule, "bureau" as const]) expect(decide(undefined, m)).toMatchObject({ allow: true, report: false });
  });

  it("allows everything while a module's switch is off, even for a company that did not buy it", () => {
    expect(decide(ent(["core", "payroll"]), "crm")).toMatchObject({ allow: true, report: false });
    expect(decide(ent(["core", "payroll"], { payroll: "ENFORCE" }), "crm")).toMatchObject({ allow: true, report: false }); // only payroll is being enforced
  });

  it("refuses a module that is switched to ENFORCE and was not bought, with a message that names it", () => {
    const d = decide(ent(["core", "payroll"], { crm: "ENFORCE" }), "crm");
    expect(d).toMatchObject({ allow: false, report: false, module: "crm" });
    expect(d.message).toBe("CRM is not part of your plan. Ask whoever looks after your account to add it.");
    expect(refusalMessage("accounting")).toBe("Accounting is not part of your plan. Ask whoever looks after your account to add it.");
  });

  it("lets a bought module through, and an ended one counts as not bought", () => {
    expect(decide(ent(["core", "payroll", "crm"], { crm: "ENFORCE" }), "crm")).toMatchObject({ allow: true });
    expect(decide(ent(["core", "payroll"], { crm: "ENFORCE" }), "crm").allow).toBe(false);
  });

  it("only reports in REPORT mode: lets it through and says it would have refused", () => {
    expect(decide(ent(["core"], { analytics: "REPORT" }), "analytics")).toMatchObject({ allow: true, report: true, module: "analytics" });
    expect(decide(ent(["core", "analytics"], { analytics: "REPORT" }), "analytics")).toMatchObject({ allow: true, report: false });
  });

  it("treats a company with no subscription as having the core only (once a module is being enforced)", () => {
    expect(decide(ent(null, { payroll: "ENFORCE" }), "payroll")).toMatchObject({ allow: false });
    expect(decide(ent(null, { payroll: "ENFORCE" }), "core")).toMatchObject({ allow: true });
  });

  it("never refuses the core, and never refuses bureau tools on module grounds (they are held to bureau mode, not to a purchase)", () => {
    const everything: Entitlements = { modules: [], modes: Object.fromEntries(everyModule.map((m) => [m, "ENFORCE"])) as Entitlements["modes"] };
    expect(decide(everything, "core").allow).toBe(true);
    expect(decide(everything, "bureau").allow).toBe(true);
  });
});

describe("finding which page a request is for", () => {
  it("matches a page's own address, with or without a query or a trailing slash", () => {
    expect(pageRouteFor("/settings/subscription")).toBe("/settings/subscription");
    expect(pageRouteFor("/settings/subscription/")).toBe("/settings/subscription");
    expect(pageRouteFor("/payroll/runs?status=APPROVED")).toBe("/payroll/runs");
    expect(pageRouteFor("/")).toBe("/");
  });

  it("matches a page with a [parameter] in it, and prefers the page with the exact address", () => {
    expect(pageRouteFor("/employees/ckx123")).toBe("/employees/[id]");
    expect(pageRouteFor("/employees/bank")).toBe("/employees/bank"); // not the [id] page
    expect(pageRouteFor("/accounting/journals/abc")).toMatch(/^\/accounting\/journals\/\[/);
  });

  it("knows no page for an address that is not one (so nothing is decided for it)", () => {
    expect(pageRouteFor("/no/such/page")).toBeNull();
    expect(pageRouteFor("/employees/abc/def/ghi")).toBeNull();
  });

  it("finds a route for every page the app has", () => {
    for (const p of discoverPages()) expect(pageRouteFor(p.route.replace(/\[[^\]]+\]/g, "x1")), p.route).not.toBeNull();
  });
});

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/auth/session", () => ({ requireAction: async () => session.ctx }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));

const person = (e?: Entitlements): Ctx => ({ userId: "u1", orgId: "o1", role: "COMPANY_ADMIN", name: "A", email: "a@x.test", employeeId: null, entitlements: e });

describe("a server action", () => {
  beforeEach(() => {
    session.ctx = null;
  });

  it("runs as before when nothing is being enforced (the state today)", async () => {
    const { actFor } = await import("@/app/actions/_run");
    session.ctx = person(undefined);
    const fn = vi.fn(async () => ({ message: "Done." }));
    expect(await actFor("inventory.ts")("inventory.manage", fn)).toMatchObject({ ok: true, message: "Done." });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("is refused in plain words, and does not run, when its module is enforced and was not bought", async () => {
    const { actFor } = await import("@/app/actions/_run");
    session.ctx = person(ent(["core", "payroll"], { inventory: "ENFORCE" }));
    const fn = vi.fn(async () => ({ message: "Done." }));
    expect(await actFor("inventory.ts")("inventory.manage", fn)).toEqual({ ok: false, error: "Inventory is not part of your plan. Ask whoever looks after your account to add it." });
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs, and only reports, in REPORT mode", async () => {
    const { actFor } = await import("@/app/actions/_run");
    session.ctx = person(ent(["core"], { inventory: "REPORT" }));
    const fn = vi.fn(async () => ({ message: "Done." }));
    expect((await actFor("inventory.ts")("inventory.manage", fn)).ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("is held to the core, and so allowed, while its entry is only a guess", async () => {
    const { UNCONFIRMED } = await import("@/lib/entitlements/entry-modules");
    const { actFor } = await import("@/app/actions/_run");
    const guess = [...UNCONFIRMED].find((u) => u.startsWith("action "));
    if (!guess) return; // none left to test with: every action entry has been confirmed
    session.ctx = person(ent(["core"], Object.fromEntries(everyModule.map((m) => [m, "ENFORCE"])) as Entitlements["modes"]));
    const fn = vi.fn(async () => ({}));
    expect((await actFor(guess.slice("action ".length))("inventory.manage", fn)).ok).toBe(true);
  });
});

describe("the wiring, so that a guard cannot be quietly left out", () => {
  const actionFiles = fs.readdirSync(path.join(ROOT, "src", "app", "actions")).filter((f) => f.endsWith(".ts") && !f.startsWith("_"));

  it("makes every server-action file take its actions from actFor with its own file name, never from the bare act", () => {
    for (const f of actionFiles) {
      const s = src("src", "app", "actions", f);
      expect(s, `${f} should call actFor("${f}")`).toContain(`const act = actFor("${f}");`);
      expect(s, `${f} imports the bare act`).not.toMatch(/import \{[^}]*\bact\b[^}]*\} from "\.\/_run"/);
    }
  });

  it("makes every signed-in API route ask the guard with its own route", () => {
    const routes = Object.keys(API_MODULES);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      if (r === "/api/unsubscribe/[token]") continue; // public: a person with no session, from a link in an email
      const file = path.join("src", "app", ...r.split("/").filter(Boolean), "route.ts");
      expect(src(file), `${r} should ask the guard`).toContain(`routeRefusal(ctx, "${r}")`);
    }
  });

  it("makes every page ask the guard (through requirePage), or only redirect to a page that does", () => {
    const session = src("src", "lib", "auth", "session.ts");
    expect(session).toMatch(/export async function requirePage[\s\S]*?pageRefusal\(ctx/);
    for (const p of discoverPages()) {
      const s = fs.readFileSync(p.file, "utf8");
      if (s.includes("requirePage(")) continue;
      expect(s, `${p.route} neither calls requirePage nor is a plain redirect`).toMatch(/^import \{ redirect \} from "next\/navigation";\s*export default function \w+\(\) \{\s*redirect\("[^"]+"\);\s*\}\s*$/);
    }
  });

  it("sets the address the page guard reads in the middleware, overwriting anything the browser sent", () => {
    const m = src("src", "middleware.ts");
    expect(m).toContain('headers.set("x-wfp-path"');
  });
});
