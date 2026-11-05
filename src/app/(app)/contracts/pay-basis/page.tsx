import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { listAllBases } from "@/server/services/pay-basis";
import { options } from "@/server/options";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveBasisAction, cancelBasisAction, proposeBasisAction, rejectBasisAction } from "@/app/actions/pay-basis";

const label = (r: { basis: string; excludePublicHolidays: boolean; workingDaysPerWeek: number | null }) =>
  r.basis === "CALENDAR_DAYS"
    ? "Calendar days (the days in the month)"
    : `Working days${r.workingDaysPerWeek ? ` (${r.workingDaysPerWeek}-day week)` : " (the company's working week)"}${r.excludePublicHolidays ? ", public holidays excluded" : ""}`;

export default async function PayBasisPage() {
  const ctx = await requirePage("client.view");
  const [rows, o] = await Promise.all([listAllBases(ctx), options(ctx)]);
  const propose = can(ctx.role, "client.manage");
  const approve = can(ctx.role, "payrate.approve");
  const today = new Date();
  const inForce = rows.filter((r) => r.status === "APPROVED" && r.effectiveFrom <= today && (!r.effectiveTo || r.effectiveTo >= today));
  const pending = rows.filter((r) => r.status === "PENDING");
  return (
    <>
      <PageHeader
        title="Paid days"
        description="How each contract's pay is divided over the month, as agreed with the client: by the days in the month (calendar days) or by the working days in it (for example 22), optionally without the public holidays. A contract with no setting keeps the company's payroll rule. A change is proposed here, approved by a payroll manager (a second person), and applies from the first day of a month. On the working-days basis a weekend or holiday day adds no basic pay: work on it is paid as overtime."
      />
      <Section title="In force today" flush>
        {inForce.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Contract</TH>
                <TH>Basis</TH>
                <TH>From</TH>
              </TR>
            </THead>
            <TBody>
              {inForce.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.contract.contractNumber} — {r.contract.client.name}: {r.contract.name}
                  </TD>
                  <TD>{label(r)}</TD>
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No contract has its own setting: every contract is paid on the company&apos;s payroll rule.</Empty>
        )}
      </Section>
      <Section title={`Waiting for approval (${pending.length})`} flush>
        {pending.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Contract</TH>
                <TH>Proposed basis</TH>
                <TH>From</TH>
                <TH>Reason</TH>
                <TH>Proposed by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.map((r) => (
                <TR key={r.id}>
                  <TD>
                    {r.contract.contractNumber} — {r.contract.client.name}
                  </TD>
                  <TD>{label(r)}</TD>
                  <TD>{fmtDate(r.effectiveFrom)}</TD>
                  <TD className="max-w-xs whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="text-xs">{r.proposedBy}</TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {approve && r.proposedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={approveBasisAction.bind(null, r.id)} confirm="Approve this paid-days basis? It applies from its effective month." variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectBasisAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {r.proposedByUserId === ctx.userId && (
                      <ActionButton action={cancelBasisAction.bind(null, r.id)} confirm="Withdraw this proposal?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing waiting.</Empty>
        )}
      </Section>
      {propose && (
        <FormPanel title="Propose a paid-days basis for a contract">
          <SmartForm
            columns={3}
            submitLabel="Propose"
            action={proposeBasisAction}
            fields={[
              { name: "contractId", label: "Contract", type: "select", required: true, options: o.contracts },
              { name: "basis", label: "Divide the month by", type: "select", required: true, options: [{ value: "WORKING_DAYS", label: "Working days in the month" }, { value: "CALENDAR_DAYS", label: "Days in the month (calendar)" }] },
              { name: "effectiveFrom", label: "From (the first day of a month)", type: "date", required: true },
              { name: "workingDaysPerWeek", label: "Working week (working days only)", type: "select", options: [{ value: "5", label: "5 days (Mon–Fri)" }, { value: "6", label: "6 days (Mon–Sat)" }, { value: "7", label: "7 days (every day)" }], help: "Blank: the company's working week (Settings → Leave policy)." },
              { name: "excludePublicHolidays", label: "Public holidays are not working days (working days only)", type: "checkbox", help: "Work on a holiday is then paid as overtime. The company's holidays for the year must be confirmed first (Payroll → Pay setup → Public holidays).", span: 2 },
              { name: "reason", label: "Why (what was agreed with the client)", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}
      {rows.some((r) => r.status !== "PENDING") && (
        <Section title="History" description="Every setting ever proposed. Nothing is overwritten." flush>
          <Table>
            <THead>
              <TR>
                <TH>Contract</TH>
                <TH>Basis</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Decided by</TH>
              </TR>
            </THead>
            <TBody>
              {rows
                .filter((r) => r.status !== "PENDING")
                .map((r) => (
                  <TR key={r.id}>
                    <TD>
                      {r.contract.contractNumber} — {r.contract.client.name}
                    </TD>
                    <TD>{label(r)}</TD>
                    <TD>{fmtDate(r.effectiveFrom)}</TD>
                    <TD>{fmtDate(r.effectiveTo)}</TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD className="text-xs">{r.decidedBy ?? "—"}</TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
