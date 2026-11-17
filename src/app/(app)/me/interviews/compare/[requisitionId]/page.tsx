import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { comparison } from "@/server/services/recruitment-panel";
import { Empty, PageHeader, Section } from "@/components/page";
import { PanelComparison } from "@/components/panel-comparison";

/** The candidates a panel member interviewed on one requisition, once those panels are closed. */
export default async function MemberComparisonPage({ params }: { params: Promise<{ requisitionId: string }> }) {
  const ctx = await requirePage();
  const { requisitionId } = await params;
  let data: Awaited<ReturnType<typeof comparison>> | null = null;
  let problem = "";
  try {
    data = await comparison(ctx, requisitionId);
  } catch (e) {
    if (e instanceof BusinessError) problem = e.message;
    else throw e;
  }
  return (
    <>
      <PageHeader title="Compare the candidates I interviewed" crumbs={[{ href: "/me/interviews", label: "My interviews" }]} description="Only interviews you sat on whose scoring is closed. Advice, never a ranking." />
      {!data ? (
        <Section title="Not available">
          <Empty>{problem}</Empty>
        </Section>
      ) : (
        <PanelComparison data={data} />
      )}
    </>
  );
}
