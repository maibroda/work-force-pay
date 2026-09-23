/**
 * Browser smoke test against a running app seeded with demo data (npm run db:seed && npm run build && npm start).
 * Visits every page as Company Admin, then checks the payslip for EMP-000025 shows all four locations,
 * and the employee / supervisor mobile views.
 */
import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/",
  "/employees",
  "/employees/new",
  "/employees/categories",
  "/employees/departments",
  "/employees/bank",
  "/employees/pension",
  "/employees/tax",
  "/clients",
  "/contracts",
  "/contracts/rates",
  "/beats",
  "/beats/bids",
  "/beats/strength",
  "/operations/activation",
  "/operations/deployments",
  "/operations/movements",
  "/operations/work-register",
  "/operations/attendance",
  "/operations/rosters",
  "/operations/absence",
  "/payroll/structures",
  "/payroll/structures/new",
  "/payroll/components",
  "/payroll/periods",
  "/payroll/runs",
  "/payroll/earnings",
  "/payroll/deductions",
  "/payroll/overtime",
  "/payroll/arrears",
  "/payroll/paye",
  "/payroll/pension",
  "/payroll/control",
  "/payroll/supplementary",
  "/payments/batches",
  "/payments/transactions",
  "/payments/reconciliation",
  "/payments/remittance",
  "/analytics/payroll",
  "/analytics/workforce-cost",
  "/analytics/client-cost",
  "/analytics/profitability",
  "/analytics/variance",
  "/analytics/locations",
  "/reports",
  "/reports/payroll-register",
  "/reports/payslips",
  "/reports/work-register",
  "/reports/staff-movement",
  "/reports/overtime",
  "/reports/arrears",
  "/reports/deductions",
  "/reports/pension",
  "/reports/paye",
  "/reports/bank",
  "/reports/client-beat",
  "/reports/beat-reconciliation",
  "/reports/location-history",
  "/reports/audit",
  "/settings/organization",
  "/settings/users",
  "/settings/roles",
  "/settings/statutory",
  "/settings/payroll-rules",
  "/settings/numbering",
  "/supervisor",
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("every page renders for Company Admin", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${(e.stack ?? e.message).slice(0, 1200)}`));
  await login(page, "admin@demosecurity.test");
  for (const p of PAGES) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBeLessThan(400);
    await expect(page.locator("h1").first(), p).toBeVisible();
    await expect(page.getByText("Application error"), p).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("payslip shows every location worked by EMP-000025", async ({ page }) => {
  await login(page, "payroll@demosecurity.test");
  await page.goto("/payroll/control");
  await page.fill("input[name=q]", "EMP-000025");
  await page.click("text=Apply");
  await page.getByRole("link", { name: "Payslip", exact: true }).first().click();
  for (const loc of ["Victoria Island Branch", "Marina Branch", "Ikoyi Branch", "Lekki"])
    await expect(page.getByText(loc, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("XYZ Manufacturing").first()).toBeVisible();
});

test("employee self-service and supervisor views", async ({ page }) => {
  await login(page, "emp25@demosecurity.test");
  await expect(page).toHaveURL(/\/me/);
  await expect(page.getByText("EMP-000025").first()).toBeVisible();
  await page.goto("/employees");
  await expect(page).toHaveURL(/forbidden/);
  await page.context().clearCookies();
  await login(page, "supervisor@demosecurity.test");
  await expect(page).toHaveURL(/\/supervisor/);
  await expect(page.getByRole("heading", { name: "Today's work register" })).toBeVisible();
});

test("UI workflow: create client, salary structure (100% validation) and employee with auto number", async ({
  page,
}) => {
  await login(page, "admin@demosecurity.test");
  const tag = Date.now().toString(36).toUpperCase();
  // client
  await page.goto("/clients");
  await page.locator("summary", { hasText: "Create client" }).click();
  await page.fill("#name", `UI Client ${tag}`);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/.+/);
  await expect(page.getByRole("heading", { name: `UI Client ${tag}` })).toBeVisible();
  // structure: break the total → error, fix → saved
  await page.goto("/payroll/structures/new");
  await page.getByPlaceholder("ABC Bank Guard Structure").fill(`UI Structure ${tag}`);
  await page.getByPlaceholder("ABC-GUARD").fill(`UI-${tag}`);
  const basic = page.locator('input[name="components.0.percentage"]');
  await basic.fill("12");
  await expect(page.getByText("Salary structure percentages must total 100%.").first()).toBeVisible();
  await page.getByRole("button", { name: "Create structure" }).click();
  await expect(page.getByText("Salary structure percentages must total 100%.").first()).toBeVisible();
  await page.locator('input[name="components.8.percentage"]').fill("11.5");
  await expect(page.getByText("✓ Totals 100%")).toBeVisible();
  await page.getByRole("button", { name: "Create structure" }).click();
  await page.waitForURL(/\/payroll\/structures\/(?!new).+/);
  await expect(page.getByRole("heading", { name: `UI Structure ${tag}` })).toBeVisible();
  // employee
  await page.goto("/employees/new");
  const next = await page.locator("code").first().innerText();
  await page.fill("#firstName", "Ui");
  await page.fill("#lastName", `Tester${tag}`);
  await page.fill("#employmentDate", "2026-09-01");
  await page.selectOption("#categoryId", { label: "Security Guard" });
  await page.getByRole("button", { name: "Create employee" }).click();
  await page.waitForURL(/\/employees\/(?!new).+/);
  await expect(page.getByRole("heading", { name: new RegExp(next) })).toBeVisible();
});
