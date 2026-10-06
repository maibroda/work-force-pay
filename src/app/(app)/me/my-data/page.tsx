import { requirePage } from "@/lib/auth/session";
import { WITHHELD_NOTES } from "@/lib/data-requests";
import { PageHeader, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";

export default async function MyDataPage() {
  const ctx = await requirePage();
  return (
    <>
      <PageHeader title="My data" description="You are entitled to a copy of the personal data the company holds about you. You can download it here whenever you like." />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <Section title="Download your data">
            <p className="mb-3 text-sm">
              A single file, built at the moment you ask, covering your personal and employment details, contracts, postings, payslips, loans, leave, training and documents, discipline and cases that are not confidential,
              the people you have told us about, signed-off appraisals, policies you have acknowledged, letters issued to you, and what you applied for. It includes your bank, tax and pension details, so keep it safe.
            </p>
            <a className={buttonVariants({ variant: "default" })} href="/api/me/data-export">
              Download my data (JSON)
            </a>
            <p className="mt-3 text-xs text-muted-foreground">Every download is recorded. If something is wrong or missing, tell HR — you can ask for it to be corrected.</p>
          </Section>
          <Section title="What is not in the file">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {WITHHELD_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Want the day-by-day attendance register or the files behind your documents? Ask HR and log it as a data access request.</p>
          </Section>
        </>
      )}
    </>
  );
}
