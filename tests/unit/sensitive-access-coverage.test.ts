import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const read = (p: string) => fs.readFileSync(p, "utf8");

/** Pages and components that show a stored bank, tax or pension identifier. */
const SHOWS_IDENTIFIER = /\b[A-Za-z]+\??\.(accountNumber|pensionPin|taxId)\b/;

/** Reasons a page may show them without recording who looked. */
const EXEMPT: Record<string, string> = {
  "app/(app)/me/page.tsx": "your own record",
  "app/(app)/portal/employees/page.tsx": "masked by the service before it gets here",
  "app/(app)/finance/bank-accounts/page.tsx": "the organization's own bank accounts, not people's",
  "app/(app)/finance/vendors/page.tsx": "suppliers' business accounts, not people's",
  "components/payslip.tsx": "drawn by the payslip page, which records it",
  "components/change-requests-panel.tsx": "drawn inside the employee page (which records it) and the employee's own page",
};

/**
 * The record of who looked at sensitive details is only as good as the pages that write to it. These checks catch a new page that shows
 * bank, tax or pension identifiers without doing so.
 */
describe("sensitive access is recorded where sensitive details are shown", () => {
  const files = walk(SRC).filter((f) => /\.tsx$/.test(f) && (rel(f).startsWith("app/(app)/") || rel(f).startsWith("components/")));

  it("every page or component that shows an identifier records the access, or says why not", () => {
    const shows = files.filter((f) => SHOWS_IDENTIFIER.test(read(f)));
    expect(shows.length).toBeGreaterThan(3);
    const missing = shows.filter((f) => !read(f).includes("recordSensitiveAccess") && !EXEMPT[rel(f)]).map(rel);
    expect(missing).toEqual([]);
  });

  it("the exemptions still exist, so the list can't go stale", () => {
    for (const f of Object.keys(EXEMPT)) expect(fs.existsSync(path.join(SRC, f)), f).toBe(true);
  });

  it("the pages that list people's personal records, change requests, reports and payslips record it too", () => {
    const must = [
      "app/(app)/employees/guarantors/page.tsx",
      "app/(app)/employees/next-of-kin/page.tsx",
      "app/(app)/employees/dependants/page.tsx",
      "app/(app)/employees/change-requests/page.tsx",
      "app/(app)/employees/[id]/page.tsx",
      "app/(app)/payslips/[id]/page.tsx",
      "app/(app)/reports/[type]/page.tsx",
      "app/(app)/payroll/paye/page.tsx",
      "app/(app)/payments/transactions/page.tsx",
      "app/(app)/payments/bank-file/[runId]/page.tsx",
    ];
    expect(must.filter((f) => !read(path.join(SRC, f)).includes("recordSensitiveAccess"))).toEqual([]);
  });

  it("is awaited, so a failed entry fails the page instead of being skipped", () => {
    const calls = files.filter((f) => read(f).includes("recordSensitiveAccess(")).flatMap((f) => read(f).split("\n").filter((l) => l.includes("recordSensitiveAccess(") && !l.includes("import")).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(calls.length).toBeGreaterThan(8);
    expect(calls.filter((c) => !/await recordSensitiveAccess\(/.test(c))).toEqual([]);
  });
});
