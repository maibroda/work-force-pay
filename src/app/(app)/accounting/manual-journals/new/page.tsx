import { requirePage } from "@/lib/auth/session";
import { dimensionOptions } from "@/server/services/dimensions";
import { postableAccountOptions } from "@/server/services/journals";
import { previewNextNumber } from "@/server/services/numbering";
import { iso } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { JournalEditor } from "../journal-editor";

export default async function NewJournalPage() {
  const ctx = await requirePage("journal.manage");
  const [accounts, dims, next] = await Promise.all([postableAccountOptions(ctx), dimensionOptions(ctx), previewNextNumber(ctx, "MANUAL_JOURNAL")]);
  return (
    <>
      <PageHeader
        title="New manual journal"
        crumbs={[{ href: "/accounting/manual-journals", label: "Manual journals" }]}
        description={`The number is given when you save — next is ${next}. Nothing reaches the ledger until the journal is approved by someone else and posted.`}
      />
      <Section title="Journal">
        <JournalEditor initial={{ id: null, kind: "MANUAL", description: "", postingDate: iso(new Date()), reverseOn: "", lines: [] }} accounts={accounts} dimensionOptions={dims} />
      </Section>
    </>
  );
}
