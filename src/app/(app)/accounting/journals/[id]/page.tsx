import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getJournal } from "@/server/services/accounting";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const j = await getJournal(ctx, id);
  if (!j) notFound();
  const balanced = Number(j.totalDebit) === Number(j.totalCredit);
  return (
    <>
      <PageHeader
        title={`Journal ${j.entryNumber}`}
        crumbs={[{ href: "/accounting/journals", label: "Journal entries" }]}
        description={j.description}
        actions={<PrintButton />}
      />
      <Section title="Details">
        <KV
          cols={4}
          items={[
            ["Posting date", fmtDate(j.postingDate)],
            ["Payroll period", j.periodName ?? "—"],
            [
              "Payroll run",
              j.run ? (
                <Link key="r" className="text-primary underline" href={`/payroll/runs/${j.runId}`}>
                  #{j.run.runNumber} {j.run.type.toLowerCase()}
                </Link>
              ) : (
                "—"
              ),
            ],
            ["Posted by", `${j.postedBy} · ${fmtDate(j.postedAt)}`],
            ["Trigger", j.source.replace(/_/g, " ").toLowerCase()],
            [
              "Status",
              <Badge key="s" tone={balanced ? "green" : "red"}>
                {balanced ? "Balanced" : "Out of balance"}
              </Badge>,
            ],
          ]}
        />
        {j.remarks && <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{j.remarks}</p>}
      </Section>
      <Section title="Lines" flush>
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Payroll head</TH>
              <TH>Narration</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
            </TR>
          </THead>
          <TBody>
            {j.lines.map((l) => (
              <TR key={l.id}>
                <TD>
                  <span className="font-mono">{l.accountCode}</span> {l.accountName}
                </TD>
                <TD className="font-mono text-xs">{l.headCode}</TD>
                <TD className="text-xs">{l.description}</TD>
                <TD className="text-right">{Number(l.debit) ? naira(l.debit) : ""}</TD>
                <TD className="text-right">{Number(l.credit) ? naira(l.credit) : ""}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={3}>Total</TD>
              <TD className="text-right">{naira(j.totalDebit)}</TD>
              <TD className="text-right">{naira(j.totalCredit)}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>
    </>
  );
}
