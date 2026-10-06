import { requirePage } from "@/lib/auth/session";
import { PersonalRecordsPanel } from "@/components/personal-records-panel";
import { PageHeader, Section } from "@/components/page";

export default async function MyContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("self.view");
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="My contacts"
        description="Your next of kin, emergency contacts, dependants and referees. Keep them up to date — they're who the company calls if something happens to you, and who receives any benefit due."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <PersonalRecordsPanel ctx={ctx} employeeId={ctx.employeeId} base="/me/contacts" edit={sp.edit} selfService />
      )}
    </>
  );
}
