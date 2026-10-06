import { requirePage } from "@/lib/auth/session";
import { ChangeRequestsPanel } from "@/components/change-requests-panel";
import { PageHeader, Section } from "@/components/page";

export default async function MyDetailsPage() {
  const ctx = await requirePage("self.view");
  return (
    <>
      <PageHeader
        title="My bank, tax & pension details"
        description="These decide where your pay goes and how it's reported. To change them, send a request — it takes effect once HR or Finance approves it, so no one can quietly redirect your pay."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <ChangeRequestsPanel ctx={ctx} employeeId={ctx.employeeId} selfService />
      )}
    </>
  );
}
