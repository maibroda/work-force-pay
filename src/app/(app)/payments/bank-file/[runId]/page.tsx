import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { listExports, paymentFilePreview } from "@/server/services/payment-file";
import { PAYMENT_FILE_HEADERS } from "@/lib/payment-file";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function BankFilePage({ params }: { params: Promise<{ runId: string }> }) {
  const ctx = await requirePage("payment.manage");
  const { runId } = await params;
  let p: Awaited<ReturnType<typeof paymentFilePreview>> | null = null;
  let why = "";
  try {
    p = await paymentFilePreview(ctx, runId);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  if (!p && why === "Payroll run not found.") notFound();
  const exports = p ? await listExports(ctx, runId) : [];

  return (
    <>
      <PageHeader
        title="Bank payment file"
        crumbs={[{ href: "/payroll/runs", label: "Payroll runs" }]}
        description="An Excel file for the client to upload to their own bank. The app only makes the file; it never moves money."
      />
      {!p && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{why}</p>}
      {p && (
        <>
          <Section title={`${p.run.period.name} — ${p.rows.length} payment(s), ${naira(p.total)}`} description={`Columns: ${PAYMENT_FILE_HEADERS.join(", ")}. Payment description: "${p.description}". Built from what was frozen with the locked payroll.`}>
            {p.alreadyPaid ? (
              <p className="text-sm text-muted-foreground">This payroll has been marked paid, so no new file is made.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {!p.problems.length && p.rows.length > 0 && (
                  <a className={buttonVariants()} href={`/api/payments/runs/${runId}/bank-file`}>
                    Download Excel file
                  </a>
                )}
                {p.problems.length > 0 && p.rows.length > 0 && (
                  <a className={buttonVariants({ variant: "outline" })} href={`/api/payments/runs/${runId}/bank-file?leaveOut=1`}>
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
                  {PAYMENT_FILE_HEADERS.map((h) => (
                    <TH key={h} className={h === "Amount" ? "text-right" : ""}>
                      {h}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {p.rows.slice(0, 200).map((r) => (
                  <TR key={r.transactionId}>
                    <TD>{r.name}</TD>
                    <TD className="font-mono text-xs">{r.accountNumber}</TD>
                    <TD className="font-mono text-xs">{r.bankCode}</TD>
                    <TD className="text-right">{naira(r.amount)}</TD>
                    <TD className="text-xs">{r.description}</TD>
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
