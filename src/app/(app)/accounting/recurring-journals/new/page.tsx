import { requirePage } from "@/lib/auth/session";
import { dimensionOptions } from "@/server/services/dimensions";
import { postableAccountOptions } from "@/server/services/journals";
import { iso } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { JournalEditor } from "../../manual-journals/journal-editor";

export default async function NewRecurringJournalPage() {
  const ctx = await requirePage("journal.manage");
  const [accounts, dims] = await Promise.all([postableAccountOptions(ctx), dimensionOptions(ctx)]);
  return (
    <>
      <PageHeader
        title="New recurring journal"
        crumbs={[{ href: "/accounting/recurring-journals", label: "Recurring journals" }]}
        description="Describe the entry once. On each date it makes a draft journal with these lines, which still has to be submitted, approved by someone else and posted."
      />
      <Section title="Template">
        <JournalEditor
          initial={{ id: null, kind: "MANUAL", description: "", postingDate: iso(new Date()), reverseOn: "", lines: [] }}
          accounts={accounts}
          dimensionOptions={dims}
          template={{ name: "", frequency: "MONTHLY", monthEnd: false, endDate: "", reverseAfterDays: "1", autoSubmit: false, scheduleLocked: false }}
        />
      </Section>
    </>
  );
}
