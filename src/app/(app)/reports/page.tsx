import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { REPORT_LINKS } from "@/lib/nav";
import { reportPermission } from "@/lib/report-access";
import { PageHeader } from "@/components/page";
import { ReportsList } from "@/components/reports-list";

export default async function ReportsHub() {
  const ctx = await requirePage("reports.view");
  const items = REPORT_LINKS.filter((i) =>
    can(ctx.role, i.href === "/finance/invoices" ? "client.view" : reportPermission(i.href.replace("/reports/", ""))),
  );
  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report, in one place. Search by name, or open a part of the business. All reports can be filtered, printed and downloaded as CSV; payroll reports roll up by client and beat."
      />
      <ReportsList items={items} />
    </>
  );
}
