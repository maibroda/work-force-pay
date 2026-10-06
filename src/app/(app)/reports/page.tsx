import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { REPORT_LINKS } from "@/lib/nav";
import { reportPermission } from "@/lib/report-access";
import { PageHeader, Section } from "@/components/page";
import { Card } from "@/components/ui/card";

export default async function ReportsHub() {
  const ctx = await requirePage("reports.view");
  const items = REPORT_LINKS.filter((i) =>
    can(ctx.role, i.href === "/finance/invoices" ? "client.view" : reportPermission(i.href.replace("/reports/", ""))),
  );
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <>
      <PageHeader
        title="Reports"
        description="All reports can be filtered, printed and downloaded as CSV. Payroll reports roll up by client and beat. Grouped the same way as the sidebar."
      />
      {groups.map((g) => (
        <Section key={g} title={g}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items
              .filter((i) => i.group === g)
              .map((i) => (
                <Link key={i.href} href={i.href}>
                  <Card className="p-4 hover:bg-accent">
                    <p className="font-medium">{i.label}</p>
                  </Card>
                </Link>
              ))}
          </div>
        </Section>
      ))}
    </>
  );
}
