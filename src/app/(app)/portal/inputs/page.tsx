import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listClientInputs, uploadableMonths } from "@/server/services/client-inputs";
import { INPUT_COLUMNS } from "@/lib/client-inputs";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { InputsForm } from "./inputs-form";

export default async function PortalInputsPage() {
  const ctx = await requirePage("portal.view");
  const send = can(ctx.role, "portal.inputs");
  const [batches, months] = await Promise.all([listClientInputs(ctx), send ? uploadableMonths(ctx) : Promise.resolve([])]);
  return (
    <>
      <PageHeader
        title="Send this month's inputs"
        description="Overtime, allowances, bonuses and deductions for your staff, sent as a file. Every row is checked before it goes; the bureau reviews what you send before it reaches the payroll."
        actions={
          send && (
            <a className="text-sm text-primary underline" href="/api/portal/inputs/template">
              Download the template
            </a>
          )
        }
      />
      {send ? (
        <Section title="Upload and check">
          <InputsForm months={months} />
        </Section>
      ) : (
        <p className="rounded bg-muted px-3 py-2 text-sm text-muted-foreground">Your HR contact sends the monthly inputs. You can follow what has been sent below.</p>
      )}
      {send && (
        <Section title="Columns" description="Column names are matched ignoring case and spacing. Amounts are naira for the whole month." flush>
          <Table>
            <THead>
              <TR>
                <TH>Column</TH>
                <TH>Notes</TH>
                <TH>Example</TH>
              </TR>
            </THead>
            <TBody>
              {INPUT_COLUMNS.map((c) => (
                <TR key={c.key}>
                  <TD className="text-xs font-medium">{c.header}</TD>
                  <TD className="whitespace-normal text-xs">{c.help}</TD>
                  <TD className="text-xs">{c.example}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
      <Section title="What you have sent" flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Month</TH>
              <TH>Sent</TH>
              <TH>By</TH>
              <TH className="text-right">Inputs</TH>
              <TH className="text-right">Earnings</TH>
              <TH className="text-right">Deductions</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {batches.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/portal/inputs/${b.id}`}>
                    {b.number}
                  </Link>
                </TD>
                <TD className="text-xs">{b.period.name}</TD>
                <TD className="text-xs">
                  {fmtDate(b.createdAt)} {b.late && <Badge tone="amber">late</Badge>}
                </TD>
                <TD className="text-xs">{b.submittedBy}</TD>
                <TD className="text-right">{b.rowCount}</TD>
                <TD className="text-right text-xs">{naira(b.earningsTotal)}</TD>
                <TD className="text-right text-xs">{naira(b.deductionsTotal)}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!batches.length && <Empty>Nothing sent yet.</Empty>}
      </Section>
    </>
  );
}
