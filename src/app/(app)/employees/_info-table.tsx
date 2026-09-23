import Link from "next/link";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { fullName } from "@/lib/utils";
import { naira } from "@/lib/money";
import { findDuplicates } from "@/server/services/employees";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Kind = "bank" | "pension" | "tax";

export async function InfoTable({ ctx, kind }: { ctx: Ctx; kind: Kind }) {
  const emps = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { notIn: ["EXITED"] } },
    orderBy: { employeeNumber: "asc" },
  });
  const dups = await findDuplicates(ctx);
  const dupType = kind === "bank" ? "BANK_ACCOUNT" : kind === "pension" ? "PENSION_PIN" : "TAX_ID";
  const dupIds = new Set(dups.filter((f) => f.type === dupType).flatMap((f) => f.employees.map((e) => e.id)));
  const missing = (e: (typeof emps)[number]) =>
    kind === "bank"
      ? !e.bankName || !e.accountNumber || !e.accountName || !/^\d{10}$/.test(e.accountNumber ?? "")
      : kind === "pension"
        ? !e.pensionPin || !e.pfa
        : !e.taxId;
  const miss = emps.filter(missing);
  const title = { bank: "Bank information", pension: "Pension information", tax: "Tax information" }[kind];
  return (
    <>
      <PageHeader
        title={title}
        description="Missing or duplicate details appear here and in Payroll Validation before approval."
      />
      <StatGrid cols={3}>
        <Stat label="Employees" value={emps.length} />
        <Stat label="Missing / invalid" value={miss.length} tone={miss.length ? "red" : "green"} />
        <Stat label="Suspected duplicates" value={dupIds.size} tone={dupIds.size ? "amber" : "green"} />
      </StatGrid>
      <Section title="Employees" flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              {kind === "bank" && (
                <>
                  <TH>Bank</TH>
                  <TH>Account number</TH>
                  <TH>Account name</TH>
                </>
              )}
              {kind === "pension" && (
                <>
                  <TH>Pension PIN</TH>
                  <TH>PFA</TH>
                </>
              )}
              {kind === "tax" && (
                <>
                  <TH>Tax ID</TH>
                  <TH>Declared annual rent</TH>
                </>
              )}
              <TH>Flags</TH>
            </TR>
          </THead>
          <TBody>
            {[...miss, ...emps.filter((e) => !missing(e))].map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/employees/${e.id}`}>
                    {e.employeeNumber}
                  </Link>
                </TD>
                <TD>{fullName(e)}</TD>
                {kind === "bank" && (
                  <>
                    <TD>{e.bankName ?? "—"}</TD>
                    <TD className="font-mono text-xs">{e.accountNumber ?? "—"}</TD>
                    <TD>{e.accountName ?? "—"}</TD>
                  </>
                )}
                {kind === "pension" && (
                  <>
                    <TD className="font-mono text-xs">{e.pensionPin ?? "—"}</TD>
                    <TD>{e.pfa ?? "—"}</TD>
                  </>
                )}
                {kind === "tax" && (
                  <>
                    <TD className="font-mono text-xs">{e.taxId ?? "—"}</TD>
                    <TD>{e.annualRent ? naira(e.annualRent) : "—"}</TD>
                  </>
                )}
                <TD className="space-x-1">
                  {missing(e) && <Badge tone="red">Missing / invalid</Badge>}
                  {dupIds.has(e.id) && <Badge tone="amber">Duplicate</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
