import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { comparison } from "@/server/services/recruitment-panel";
import { Empty, PageHeader, Section } from "@/components/page";
import { PanelComparison } from "@/components/panel-comparison";
import { can } from "@/lib/auth/permissions";

export default async function ComparisonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage();
  const { id } = await params;
  let data: Awaited<ReturnType<typeof comparison>> | null = null;
  let problem = "";
  try {
    data = await comparison(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) problem = e.message;
    else throw e;
  }
  const hr = can(ctx.role, "recruitment.assess");
  return (
    <>
      <PageHeader
        title="Compare candidates"
        crumbs={[{ href: "/hr/requisitions", label: "Requisitions" }, { href: `/hr/requisitions/${id}`, label: "Requisition" }]}
        description="What each interview panel said, side by side. Advice for the people deciding, never a ranking."
      />
      {!data ? (
        <Section title="Not available">
          <Empty>{problem}</Empty>
        </Section>
      ) : (
        <PanelComparison data={data} candidateHref={hr ? (cid) => `/hr/candidates/${cid}` : undefined} />
      )}
    </>
  );
}
