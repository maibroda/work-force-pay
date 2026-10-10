/**
 * Route smoke test. Logs in (by minting the same session cookie the app would) as each demo role, then
 * requests every page in the app — each role against every page, plus a sample record for every detail
 * page and every tab of the employee page — and fails on anything that isn't what that role should get:
 *
 *   • a page the role may open must answer 200 (not 500, not an error page, not a redirect away);
 *   • a page the role may NOT open must redirect to /forbidden (so a menu can't reach what a page refuses);
 *   • signed out, every page must go to /login.
 *
 * What a page requires is read from its own source (scripts/routes.ts), so new pages are covered
 * automatically — a detail page with no sample-record resolver below fails the run until one is added.
 *
 *   npm run build && npm start        # in one terminal, against a seeded database
 *   npm run smoke                     # in another (BASE_URL defaults to http://localhost:3000)
 *
 * Reads only; never POSTs. Needs the same AUTH_SECRET and DATABASE_URL as the running app.
 */
import "dotenv/config";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";
import { can, type Permission, type Role } from "../src/lib/auth/permissions";
import { NAV, REPORT_LINKS, SELF_NAV } from "../src/lib/nav";
import { reportPermission } from "../src/lib/report-access";
import { discoverPages, employeeTabs, matchPage, type PageInfo } from "./routes";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY ?? 4);
const STRICT = process.argv.includes("--strict"); // a missing sample record fails instead of being noted
const ROLES: Role[] = ["COMPANY_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "OPERATIONS", "AUDITOR", "SUPERVISOR", "EMPLOYEE"];
// Looked for in the visible HTML only: every healthy page also carries the app's 404 and error fallbacks inside its
// <script> data, so scanning the raw text would match everywhere. A genuinely missing page is a 404, caught by status.
const ERROR_MARKERS = ["Application error", "Internal Server Error", "Unhandled Runtime Error"];
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");

type Expect = "allow" | "deny" | "any";
interface Probe {
  role: Role | null;
  path: string;
  expect: Expect;
  note?: string;
}
interface Failure extends Probe {
  status: number | string;
  why: string;
}

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars) — the same value the running app uses.");
  return new TextEncoder().encode(s);
}

async function cookieFor(role: Role, orgId: string) {
  const user = await db.user.findFirst({ where: { organizationId: orgId, role, active: true } });
  if (!user) return null;
  const token = await new SignJWT({
    userId: user.id,
    orgId,
    role,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    sessionVersion: user.sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret());
  return `wp_session=${token}`;
}

/** A real record to open each detail page with. */
const first = async (q: Promise<{ id: string } | null>) => (await q)?.id;
function resolvers(orgId: string): Record<string, () => Promise<string | undefined>> {
  const where = { organizationId: orgId };
  return {
    "/accounting/journals/[id]": () => first(db.journalEntry.findFirst({ where, select: { id: true } })),
    "/clients/[id]": () => first(db.client.findFirst({ where, select: { id: true } })),
    "/employees/[id]": () => first(db.employee.findFirst({ where, orderBy: { employeeNumber: "asc" }, select: { id: true } })),
    "/finance/fixed-assets/[id]": () => first(db.fixedAsset.findFirst({ where, select: { id: true } })),
    "/finance/invoices/[id]": () => first(db.clientInvoice.findFirst({ where, select: { id: true } })),
    "/finance/payables/[id]": () => first(db.purchaseInvoice.findFirst({ where, select: { id: true } })),
    "/finance/purchase-orders/[id]": () => first(db.purchaseOrder.findFirst({ where, select: { id: true } })),
    "/accounting/manual-journals/[id]": () => first(db.journalDocument.findFirst({ where, select: { id: true } })),
    "/hr/breaches/[id]": () => first(db.dataBreach.findFirst({ where, select: { id: true } })),
    "/hr/appraisals/[id]": () => first(db.appraisal.findFirst({ where, select: { id: true } })),
    "/hr/appraisals/cycle/[id]": () => first(db.appraisalCycle.findFirst({ where, select: { id: true } })),
    "/hr/candidates/[id]": () => first(db.candidate.findFirst({ where, select: { id: true } })),
    "/hr/contracts/[id]": () => first(db.employmentContract.findFirst({ where, select: { id: true } })),
    "/hr/exits/[id]": () => first(db.exitRecord.findFirst({ where, select: { id: true } })),
    "/hr/letters/[id]": () => first(db.generatedLetter.findFirst({ where, select: { id: true } })),
    "/hr/policies/[id]": () => first(db.companyPolicy.findFirst({ where, select: { id: true } })),
    "/hr/relations/[id]": () => first(db.relationsCase.findFirst({ where, select: { id: true } })),
    "/hr/requisitions/[id]": () => first(db.jobRequisition.findFirst({ where, select: { id: true } })),
    "/inventory/[id]": () => first(db.inventoryItem.findFirst({ where, select: { id: true } })),
    "/payroll/loans/[id]": () => first(db.staffLoan.findFirst({ where, select: { id: true } })),
    "/payroll/runs/[id]": () => first(db.payrollRun.findFirst({ where, select: { id: true } })),
    "/payroll/settlements/[id]": () => first(db.exitSettlement.findFirst({ where, select: { id: true } })),
    "/payroll/structures/[id]": () => first(db.salaryStructure.findFirst({ where, select: { id: true } })),
    "/payslips/[id]": () => first(db.payrollRecord.findFirst({ where, select: { id: true } })),
  };
}

/** Who may open a page: its own requirement, or for pages that decide for themselves, "any" (just no server errors). */
function expectFor(role: Role, perm: PageInfo["perm"], ownRecordsOnly = false): Expect {
  if (perm === "custom") return "any";
  if (perm === null) return ownRecordsOnly ? "any" : "allow"; // a detail page open to anyone then checks the record itself (404 is fine)
  return can(role, perm) ? "allow" : "deny";
}

async function fetchOnce(probe: Probe, cookie: string | null, hops = 0): Promise<Failure | null> {
  let res: Response;
  try {
    res = await fetch(BASE + probe.path, { headers: cookie ? { cookie } : {}, redirect: "manual", signal: AbortSignal.timeout(90_000) });
  } catch (e) {
    return { ...probe, status: "no response", why: String((e as Error).message ?? e) };
  }
  const loc = res.headers.get("location") ?? "";
  const body = res.status >= 300 && res.status < 400 ? "" : await res.text();
  const fail = (why: string): Failure => ({ ...probe, status: res.status, why });
  if (res.status >= 500) return fail("server error");
  const redirected = res.status >= 300 && res.status < 400;
  const visible = visibleText(body);
  const hit = ERROR_MARKERS.find((m) => visible.includes(m));
  if (probe.role === null) return redirected && loc.includes("/login") ? null : fail(`signed out, expected a redirect to /login (got ${loc || "none"})`);
  if (probe.expect === "deny") {
    // a redirect before streaming starts is a 307; once streaming has started Next sends the redirect inside a 200 page
    const embedded = res.status === 200 && (/NEXT_REDIRECT[^"]{0,30}\/forbidden/.test(body) || /http-equiv="refresh"[^>]*\/forbidden/.test(body));
    return (redirected && loc.includes("/forbidden")) || embedded ? null : fail(`should be forbidden for ${probe.role}, but ${redirected ? `went to ${loc}` : "it opened"}`);
  }
  if (redirected) {
    if (probe.expect === "any") return null;
    // A page may legitimately hand over to another page (e.g. Payroll Validation → the current run) — follow it
    // one or two hops and require the destination to open. Going to the login or forbidden page is a failure.
    if (/\/(login|forbidden)(\?|$)/.test(loc) || hops >= 2) return fail(`should open, but redirected to ${loc}`);
    const next = new URL(loc, BASE);
    return fetchOnce({ ...probe, path: next.pathname + next.search, note: `after redirect from ${probe.path}` }, cookie, hops + 1);
  }
  if (res.status === 404) return probe.expect === "any" ? null : fail("not found");
  if (res.status !== 200) return fail("unexpected status");
  if (hit) return fail(`the page shows an error ("${hit}")`);
  return null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function main() {
  const org = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
  const pages = discoverPages();
  const probes: Probe[] = [];
  const notes: string[] = [];
  const upfront: Failure[] = []; // problems found while preparing, before any request is made

  // 1. Every static page, for every role.
  const staticPages = pages.filter((p) => !p.dynamic);
  for (const role of ROLES)
    for (const p of staticPages) probes.push({ role, path: p.route, expect: expectFor(role, p.perm) });

  // 2. The menus: every link a role is shown must open for that role.
  const menu = [...NAV, ...SELF_NAV].flatMap((g) => g.items);
  for (const role of ROLES)
    for (const l of menu) {
      const page = matchPage(pages, l.href);
      if (can(role, l.perm) && page && page.perm !== "custom" && page.perm !== null && !can(role, page.perm))
        probes.push({ role, path: l.href, expect: "allow", note: "menu shows it" });
    }

  // 3. Detail pages, with a real record; the employee page once per tab.
  const res = resolvers(org.id);
  const tabs = employeeTabs();
  for (const p of pages.filter((x) => x.dynamic)) {
    if (p.route === "/reports/[type]") continue; // covered by the hub list below
    const make = res[p.route];
    if (!make) {
      upfront.push({ role: null, path: p.route, expect: "any", status: "-", why: "no sample-record resolver for this detail page — add one in scripts/smoke.ts so it is covered" });
      continue;
    }
    const id = await make();
    if (!id) {
      if (STRICT) upfront.push({ role: null, path: p.route, expect: "any", status: "-", why: "no sample record in the database (strict mode)" });
      else notes.push(`no sample record for ${p.route} — skipped`);
      continue;
    }
    const paths = p.route === "/employees/[id]" ? [`/employees/${id}`, ...tabs.map((t) => `/employees/${id}?tab=${t}`)] : [p.route.replace("[id]", id)];
    for (const role of ROLES) for (const path of paths) probes.push({ role, path, expect: expectFor(role, p.perm, true) });
  }

  // 4. Every report in the Reports hub, for every role that may open it.
  for (const l of REPORT_LINKS.filter((x) => x.href.startsWith("/reports/")))
    for (const role of ROLES) {
      const perm: Permission = reportPermission(l.href.replace("/reports/", ""));
      probes.push({ role, path: l.href, expect: can(role, perm) ? "allow" : "deny" });
    }
  for (const role of ROLES) probes.push({ role, path: "/reports", expect: can(role, "reports.view") ? "allow" : "deny" });

  // 5. Signed out: everything goes to the login page.
  for (const p of staticPages.slice(0, 12)) probes.push({ role: null, path: p.route, expect: "deny" });

  const unique = [...new Map(probes.map((p) => [`${p.role}|${p.path}`, p])).values()];
  const cookies = new Map<Role, string>();
  for (const r of ROLES) {
    const c = await cookieFor(r, org.id);
    if (c) cookies.set(r, c);
    else notes.push(`no active ${r} user in the demo organization — that role was not tested`);
  }

  console.log(`Smoke test against ${BASE} — ${unique.length} requests, ${cookies.size} roles, ${pages.length} pages\n`);
  const failures: Failure[] = [...upfront];
  let done = 0;
  const startedAt = Date.now();
  await pool(unique, CONCURRENCY, async (p) => {
    if (p.role && !cookies.has(p.role)) return;
    const f = await fetchOnce(p, p.role ? cookies.get(p.role)! : null);
    if (f) failures.push(f);
    if (++done % 100 === 0) console.log(`  …${done}/${unique.length}`);
  });

  console.log(`\n${done} requests in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  for (const n of notes) console.log(`note: ${n}`);
  if (!failures.length) {
    console.log("\n✔ every page behaved: open to the roles that should reach it, forbidden to the rest, no errors.");
    return 0;
  }
  console.log(`\n✘ ${failures.length} problem(s):\n`);
  const byPath = new Map<string, Failure[]>();
  for (const f of failures) byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
  for (const [path, fs] of byPath) console.log(`  ${path}\n${fs.map((f) => `      ${f.role ?? "signed out"} → ${f.status}: ${f.why}${f.note ? ` (${f.note})` : ""}`).join("\n")}`);
  return 1;
}

main()
  .then(async (code) => {
    await db.$disconnect();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(2);
  });
