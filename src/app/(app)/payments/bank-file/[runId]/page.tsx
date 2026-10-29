import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { listExports, paymentFilePreview } from "@/server/services/payment-file";
import { recordSensitiveAccess } from "@/server/services/sensitive-access";
import { GENERIC_LAYOUT, layoutCells } from "@/lib/paying-bank";
import { listPayingBanks } from "@/server/services/paying-banks";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function BankFilePage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ bank?: string }> }) {
  const ctx = await requirePage("payment.manage");
  const { runId } = await params;
  const { bank } = await searchParams;
  const payingBanks = (await listPayingBanks(ctx)).filter((b) => b.active);
  const bankId = bank && payingBanks.some((b) => b.id === bank) ? bank : null;
  const bankQuery = bankId ? `bank=${bankId}` : "";
  let p: Awaited<ReturnType<typeof paymentFilePreview>> | null = null;
  let why = "";
  try {
    p = await paymentFilePreview(ctx, runId, { payingBankId: bankId });
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  if (!p && why === "Payroll run not found.") notFound();
  if (p) await recordSensitiveAccess(ctx, { kind: "PAYMENTS", ref: runId, count: p.rows.length });
  const exports = p ? await listExports(ctx, runId) : [];
  const payingNames = new Map((await listPayingBanks(ctx)).map((b) => [b.id, b.name]));
  // the rows as the bank's file will have them; the company's own account is shown masked
  const layout = p?.payingBank?.layout ?? GENERIC_LAYOUT;
  const shown = layoutCells(layout, p?.rows.slice(0, 200) ?? [], p?.payingBank?.debitAccountNumber ? `••••${p.payingBank.debitAccountNumber.slice(-4)}` : null);

  return (
    <>
      <PageHeader
        title="Bank payment file"
        crumbs={[{ href: "/payroll/runs", label: "Payroll runs" }]}
        description="A file for the client to upload to their own bank. The app only makes the file; it never moves money."
      />
      <Section title="Paying bank" description="The bank the client pays from decides the bank codes and the layout of the file. With none chosen, the general file is made, using the general bank list.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[{ id: null as string | null, name: "General file" }, ...payingBanks].map((b) => (
            <Link key={b.id ?? "general"} href={b.id ? `?bank=${b.id}` : "?"} className={buttonVariants({ variant: b.id === bankId ? "default" : "outline", size: "sm" })}>
              {b.name}
            </Link>
          ))}
          <Link className="text-xs underline" href="/payments/paying-banks">
            Set up paying banks
          </Link>
        </div>
      </Section>
      {!p && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{why}</p>}
      {p && (
        <>
          <Section title={`${p.run.period.name} — ${p.rows.length} payment(s), ${naira(p.total)}`} description={`Columns: ${(p.payingBank?.layout ?? GENERIC_LAYOUT).columns.map((c) => c.header).join(", ")}. Payment description: "${p.description}". Built from what was frozen with the locked payroll.`}>
            {p.blockers.length > 0 && <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{p.blockers.join(" ")}</p>}
            {p.alreadyPaid ? (
              <p className="text-sm text-muted-foreground">This payroll has been marked paid, so no new file is made.</p>
            ) : p.blockers.length > 0 ? null : (
              <div className="flex flex-wrap items-center gap-3">
                {!p.problems.length && p.rows.length > 0 && (
                  <a className={buttonVariants()} href={`/api/payments/runs/${runId}/bank-file${bankQuery ? `?${bankQuery}` : ""}`}>
                    Download file
                  </a>
                )}
                {p.problems.length > 0 && p.rows.length > 0 && (
                  <a className={buttonVariants({ variant: "outline" })} href={`/api/payments/runs/${runId}/bank-file?leaveOut=1${bankQuery ? `&${bankQuery}` : ""}`}>
                    Download without the {p.problems.length} employee(s) below
                  </a>
                )}
                {p.problems.length > 0 && <span className="text-xs text-muted-foreground">Those employees must be paid separately; who was left out is recorded.</span>}
              </div>
            )}
          </Section>

          {p.problems.length > 0 && (
            <Section title={`${p.problems.length} employee(s) who cannot go in the file`} flush>
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Problem</TH>
                  </TR>
                </THead>
                <TBody>
                  {p.problems.map((x) => (
                    <TR key={x.transactionId} className="bg-red-50/60">
                      <TD className="text-xs">
                        {x.employeeNumber} {x.name}
                      </TD>
                      <TD className="whitespace-normal text-xs">{x.problems.join(" ")}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}

          {p.warnings.length > 0 && (
            <Section title="Check before sending" flush>
              <Table>
                <TBody>
                  {p.warnings.map((x) => (
                    <TR key={x.transactionId}>
                      <TD className="text-xs">
                        {x.employeeNumber} {x.name}
                      </TD>
                      <TD className="whitespace-normal text-xs">{x.message}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}

          <Section title="Rows in the file" flush>
            <Table>
              <THead>
                <TR>
                  {shown.header.map((h, i) => (
                    <TH key={h} className={layout.columns[i].source === "AMOUNT" ? "text-right" : ""}>
                      {h}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {shown.body.map((cells, n) => (
                  <TR key={p.rows[n].transactionId}>
                    {cells.map((v, i) => (
                      <TD key={i} className={layout.columns[i].source === "AMOUNT" ? "text-right" : ["DEBIT_ACCOUNT", "CREDIT_ACCOUNT", "BANK_CODE"].includes(layout.columns[i].source) ? "font-mono text-xs" : "text-xs"}>
                        {layout.columns[i].source === "AMOUNT" ? naira(v as number) : v}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
            {p.rows.length > 200 && <p className="px-4 py-2 text-xs text-muted-foreground">Showing the first 200 of {p.rows.length}.</p>}
          </Section>

          <Section title="Files made" flush>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>By</TH>
                  <TH>Paying bank</TH>
                  <TH className="text-right">Payments</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Left out</TH>
                  <TH>Fingerprint</TH>
                </TR>
              </THead>
              <TBody>
                {exports.map((x) => (
                  <TR key={x.id}>
                    <TD>{fmtDate(x.createdAt)}</TD>
                    <TD className="text-xs">{x.createdBy}</TD>
                    <TD className="text-xs">{x.payingBankId ? `${payingNames.get(x.payingBankId) ?? "—"}, list v${x.codeSetVersion}` : "General"}</TD>
                    <TD className="text-right">{x.rowCount}</TD>
                    <TD className="text-right">{naira(x.totalAmount)}</TD>
                    <TD className="text-xs">{(x.excluded as unknown[]).length || "—"}</TD>
                    <TD className="font-mono text-xs">{x.checksum.slice(0, 12)}…</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!exports.length && <p className="px-4 py-4 text-sm text-muted-foreground">No file has been made for this payroll yet.</p>}
          </Section>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Bank codes come from <Link className="underline" href="/payments/bank-codes">the bank list</Link>. Confirm them against the upload guide of the bank the client pays from before the first file is sent.
      </p>
    </>
  );
}
