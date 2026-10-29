import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { BusinessError } from "@/server/services/_base";
import { getOpportunity } from "@/server/services/sales/deals";
import { PageHeader, Section } from "@/components/page";
import { QuoteBuilder } from "./quote-builder";

export default async function NewQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.manage");
  const { id } = await params;
  let v;
  try {
    v = await getOpportunity(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const structures = await db.salaryStructure.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } });
  return (
    <>
      <PageHeader title={`Quote for ${v.opportunity.name}`} crumbs={[{ href: `/sales/opportunities/${id}`, label: v.opportunity.name }]} description={`${v.opportunity.account.name}. Each line is priced against what the guards really cost, so you see the margin before the quote goes out.`} />
      <Section
        title="Lines"
        description="The guard's monthly gross is the bill rate times the share paid to the guard (70% unless you give another). The cost adds the employer's pension (on the pensionable pay: Basic, Housing and Transport in the standard structure), ITF and NSITF (on gross) and the other employer costs, at the percentages in the rules in force today, worked out by the same functions and rounding as payroll."
      >
        {structures.length ? <QuoteBuilder opportunityId={id} structures={structures} /> : <p className="text-sm text-amber-800">No active pay structure exists yet, so a guard&apos;s cost cannot be worked out. Add one under Salary Structures first.</p>}
      </Section>
    </>
  );
}
