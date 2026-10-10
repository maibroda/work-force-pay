import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { certificateReconciliation, listCertificates } from "@/server/services/certificates";
import { MATCH_HELP, MATCH_LABELS, type MatchStatus } from "@/lib/certificates";
import { options } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { registerCertificateAction, voidCertificateAction } from "@/app/actions/certificates";

const tone: Record<MatchStatus, "green" | "amber" | "red" | "blue"> = { MATCHED: "green", CERT_SHORT: "red", CERT_EXCEEDS: "amber", MISSING: "red", NOT_RECORDED: "blue" };

export default async function WhtCertificatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const o = await options(ctx);
  const [rec, certs] = await Promise.all([certificateReconciliation(ctx, { clientId: sp.clientId }), listCertificates(ctx, { clientId: sp.clientId })]);
  const rows = sp.status ? rec.rows.filter((r) => r.status === sp.status) : rec.rows;
  const manage = can(ctx.role, "tax.manage");
  const today = iso(new Date());
  const open = rec.rows.filter((r) => r.status !== "MATCHED").length;
  const ledgerAgrees = Math.abs(rec.totals.ledger - rec.totals.withheld) < 0.01;
  return (
    <>
      <PageHeader
        title="Withholding tax certificates"
        description="When a client withholds tax on paying us they owe us a credit note or certificate, and the tax authority credits the tax against ours only on production of it. Receipts and deductions carry the certificate number the client quoted; the register holds the certificates actually received. They are matched on client and number (spaces, punctuation and case are ignored), so you can see what has been withheld with no certificate yet to chase, and where a certificate disagrees with what was withheld. A certificate is evidence: it is never edited or deleted, and a wrong one is voided with a reason and entered again."
      />
      <StatGrid cols={4}>
        <Stat label="Withheld by clients" value={naira(rec.totals.withheld)} />
        <Stat label="Evidenced by certificates" value={naira(rec.totals.certified)} tone="green" />
        <Stat label="Still to chase" value={naira(rec.totals.uncertified)} tone={rec.totals.uncertified ? "red" : "green"} />
        <Stat label="Numbers needing attention" value={open} tone={open ? "amber" : "green"} />
      </StatGrid>
      <p className={`mb-4 rounded-md p-3 text-sm ${ledgerAgrees ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
        {ledgerAgrees
          ? `Withholding tax receivable in the ledger (${naira(rec.totals.ledger)}) agrees with the tax recorded as withheld.`
          : `Withholding tax receivable in the ledger is ${naira(rec.totals.ledger)}, but ${naira(rec.totals.withheld)} is recorded as withheld. The difference is usually a manual journal against the account (for example once a credit has been used).`}
      </p>

      <FilterBar>
        <FilterField label="Client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {(Object.keys(MATCH_LABELS) as MatchStatus[]).map((s) => (
              <option key={s} value={s}>
                {MATCH_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Section title="Withheld against certificates" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Certificate no.</TH>
              <TH className="text-right">Withheld</TH>
              <TH className="text-right">Certificate</TH>
              <TH className="text-right">Difference</TH>
              <TH>Status</TH>
              <TH>Recorded on</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.clientId}|${r.key}`}>
                <TD>{r.client}</TD>
                <TD className="font-mono text-xs">{r.label}</TD>
                <TD className="text-right">{r.withheld ? naira(r.withheld) : "—"}</TD>
                <TD className="text-right">{r.certified ? naira(r.certified) : "—"}</TD>
                <TD className="text-right">{r.difference ? naira(r.difference) : "—"}</TD>
                <TD className="max-w-[16rem] whitespace-normal">
                  <Badge tone={tone[r.status]}>{MATCH_LABELS[r.status]}</Badge>
                  <div className="mt-1 text-xs text-muted-foreground">{MATCH_HELP[r.status]}</div>
                </TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">{r.sources.join(", ") || "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No withholding recorded and no certificates registered{sp.status || sp.clientId ? " for this filter" : ""}.</Empty>}
      </Section>

      <Section title={`Certificates on the register (${certs.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Certificate no.</TH>
              <TH>Issued</TH>
              <TH>Received</TH>
              <TH className="text-right">Amount</TH>
              <TH>Original kept at</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {certs.map((c) => (
              <TR key={c.id}>
                <TD>{c.client.name}</TD>
                <TD className="font-mono text-xs">{c.certificateNumber}</TD>
                <TD className="text-xs">{fmtDate(c.issueDate)}</TD>
                <TD className="text-xs">{fmtDate(c.receivedDate)}</TD>
                <TD className="text-right">{naira(num(c.amount))}</TD>
                <TD className="max-w-[16rem] whitespace-normal text-xs">
                  {c.document ?? "—"}
                  {c.notes ? <div className="text-muted-foreground">{c.notes}</div> : null}
                </TD>
                <TD className="text-right">
                  {manage && (
                    <ActionButton action={voidCertificateAction.bind(null, c.id)} reason reasonPlaceholder="Why it is being voided" variant="outline">
                      Void
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!certs.length && <Empty>No certificates registered yet.</Empty>}
      </Section>

      {manage && (
        <FormPanel title="Register a certificate">
          <SmartForm
            columns={3}
            submitLabel="Register certificate"
            action={registerCertificateAction}
            fields={[
              { name: "clientId", label: "Client", type: "select", required: true, options: o.clients },
              { name: "certificateNumber", label: "Certificate / credit note no.", type: "text", required: true, help: "As printed. Matched to receipts by this number." },
              { name: "amount", label: "Tax certified", type: "number", min: 0, required: true },
              { name: "issueDate", label: "Date on the certificate", type: "date", required: true, defaultValue: today },
              { name: "receivedDate", label: "Date received", type: "date", required: true, defaultValue: today },
              { name: "document", label: "Original kept at", type: "text", placeholder: "e.g. Scans/2026/WHT-77.pdf" },
              { name: "notes", label: "Notes", type: "text", span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
