import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listGuarantors, recordsOverview } from "@/server/services/personal-records";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { rejectGuarantorAction, verifyGuarantorAction } from "@/app/actions/personal-records";

const FILTERS = [
  ["", "Needs action"],
  ["VERIFIED", "Verified"],
  ["REJECTED", "Rejected"],
  ["RELEASED", "Released"],
  ["ALL", "All"],
] as const;

export default async function GuarantorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("employee.sensitive");
  const sp = await searchParams;
  const filter = sp.status ?? "";
  const manage = can(ctx.role, "hr.manage");
  const [{ rows, totals, policy }, all] = await Promise.all([recordsOverview(ctx), listGuarantors(ctx)]);
  const shown = all.filter((g) => (filter === "ALL" ? true : filter ? g.status === filter : g.status === "PENDING"));
  const short = rows.filter((r) => r.gaps.guarantorsMissing > 0);
  const needing = rows.filter((r) => r.gaps.guarantorsNeeded > 0).length;
  return (
    <>
      <PageHeader
        title="Guarantors"
        description={`${
          policy.guarantorsRequired > 0
            ? `Policy: ${policy.guarantorsRequired} verified guarantor(s) per employee${policy.guarantorCategoryIds.length ? " in the chosen categories" : ""}; one person may guarantee at most ${policy.guarantorMaxPerPerson || "any number of"} employee(s)${policy.guarantorSeparateVerifier ? "; someone other than the recorder must verify" : ""}.`
            : "Guarantors aren't required by the current policy."
        } Change this under Settings → HR & Lifecycle Policy. Add or edit a guarantor from the employee's Contacts & guarantors tab.`}
      />
      <StatGrid cols={4}>
        <Stat label="Employees needing guarantors" value={needing} />
        <Stat label="Short of verified guarantors" value={totals.guarantorShort} tone={totals.guarantorShort ? "red" : "green"} />
        <Stat label="Awaiting verification" value={totals.guarantorsPending} tone={totals.guarantorsPending ? "amber" : "green"} />
        <Stat label="Rejected" value={totals.guarantorsRejected} tone={totals.guarantorsRejected ? "amber" : "green"} />
      </StatGrid>

      <Section
        title="Guarantors"
        description={
          <span className="flex flex-wrap gap-2">
            {FILTERS.map(([k, label]) => (
              <Link key={k} href={k ? `/employees/guarantors?status=${k}` : "/employees/guarantors"} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${filter === k ? "bg-primary text-primary-foreground ring-primary" : "ring-border hover:bg-muted"}`}>
                {label}
              </Link>
            ))}
          </span>
        }
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Guarantor</TH>
              <TH>Phone</TH>
              <TH>ID / form</TH>
              <TH>Recorded</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {shown.map((g) => (
              <TR key={g.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/employees/${g.employee.id}?tab=contacts`}>
                    {g.employee.employeeNumber}
                  </Link>{" "}
                  <span className="text-xs">{fullName(g.employee)}</span>
                </TD>
                <TD>
                  {g.fullName}
                  <div className="text-xs text-muted-foreground">{g.relationship}</div>
                </TD>
                <TD className="text-xs">{g.phone}</TD>
                <TD className="text-xs">
                  {g.idType ? `${g.idType.replace(/_/g, " ")} ${g.idNumber ?? ""}` : <Badge tone="amber">No ID</Badge>}
                  <div className="text-muted-foreground">{g.formReference ?? "no form on file"}</div>
                </TD>
                <TD className="text-xs">
                  {fmtDate(g.createdAt)}
                  <div className="text-muted-foreground">{g.recordedBy}</div>
                </TD>
                <TD className="max-w-[14rem] whitespace-normal text-xs">
                  <StatusBadge status={g.status} />
                  {g.verifiedBy && (
                    <div className="mt-1 text-muted-foreground">
                      {g.verifiedBy}, {fmtDate(g.verifiedAt)} — {g.verificationNote}
                    </div>
                  )}
                </TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {manage && g.status === "PENDING" && (
                    <>
                      <ActionButton action={verifyGuarantorAction.bind(null, g.id)} reason reasonPlaceholder="How you verified (called, visited…)">
                        Verify
                      </ActionButton>
                      <ActionButton action={rejectGuarantorAction.bind(null, g.id)} reason variant="outline">
                        Reject
                      </ActionButton>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!shown.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{filter ? "No guarantors with that status." : "Nothing is waiting for verification."}</p>}
      </Section>

      {short.length > 0 && (
        <Section title="Employees short of verified guarantors" flush>
          <Table>
            <THead>
              <TR>
                <TH>Emp. No.</TH>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Needed</TH>
                <TH>Verified</TH>
                <TH>Pending</TH>
              </TR>
            </THead>
            <TBody>
              {short.map((r) => (
                <TR key={r.employee.id}>
                  <TD>
                    <Link className="text-primary hover:underline" href={`/employees/${r.employee.id}?tab=contacts`}>
                      {r.employee.employeeNumber}
                    </Link>
                  </TD>
                  <TD>{fullName(r.employee)}</TD>
                  <TD className="text-xs">{r.employee.category.name}</TD>
                  <TD>{r.gaps.guarantorsNeeded}</TD>
                  <TD>{r.gaps.guarantorsVerified}</TD>
                  <TD>{r.gaps.guarantorsPending}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
