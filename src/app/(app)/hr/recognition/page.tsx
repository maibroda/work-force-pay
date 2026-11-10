import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { AWARD_STATUSES, AWARD_STATUS_LABELS, type AwardStatus } from "@/lib/recognition";
import { listAwardTypes, listAwards, milestones } from "@/server/services/recognition";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { AwardList } from "@/components/award-list";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addAwardTypeAction, nominateAction, setAwardTypeActiveAction } from "@/app/actions/recognition";

export default async function RecognitionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const status = (AWARD_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as AwardStatus) : undefined;
  const [rows, types, due] = await Promise.all([listAwards(ctx, { status }), listAwardTypes(ctx), milestones(ctx)]);
  const canConfigure = can(ctx.role, "hr.configure");
  const canNominate = can(ctx.role, "recognition.nominate");
  const active = types.filter((t) => t.active);
  return (
    <>
      <PageHeader
        title="Recognition"
        description="Awards for people who have done something well or served a long time. A manager or HR nominates someone with a few plain sentences; someone other than the nominator decides. The employee is told only of an award that was approved, never of a nomination still being considered or one that was declined. Recognition carries no money: it changes no pay, status or appraisal."
      />
      {canNominate && (
        <FormPanel title="Nominate someone">
          {active.length === 0 ? (
            <Empty>No award is set up yet. Add one below first.</Empty>
          ) : (
            <SmartForm
              columns={3}
              submitLabel="Send the nomination"
              action={nominateAction}
              fields={[
                { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                { name: "typeId", label: "Award", type: "select", required: true, options: active.map((t) => ({ value: t.id, label: t.name })) },
                { name: "citation", label: "Why they deserve it, in a few plain sentences. The employee will read this if the award is approved.", type: "textarea", required: true, span: 3 },
              ]}
            />
          )}
        </FormPanel>
      )}
      <FilterBar action="/hr/recognition">
        <FilterField label="Status">
          <Select name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {AWARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {AWARD_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} nomination${rows.length === 1 ? "" : "s"}`} flush>
        <AwardList rows={rows} canDecide={can(ctx.role, "hr.approve")} userId={ctx.userId} />
      </Section>

      <Section title="Long-service milestones coming up" description="Staff reaching a long-service year within the next 60 days. This is only a prompt: nothing is created until someone nominates.">
        {due.length === 0 ? (
          <Empty>No one reaches a milestone in the next 60 days.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Milestone</TH>
                <TH>On</TH>
                <TH>Award</TH>
              </TR>
            </THead>
            <TBody>
              {due.map((m) => (
                <TR key={`${m.employee.id}-${m.years}`}>
                  <TD>
                    {fullName(m.employee)}
                    <div className="text-xs text-muted-foreground">{m.employee.employeeNumber}</div>
                  </TD>
                  <TD>{m.years} years</TD>
                  <TD>{fmtDate(m.on)}</TD>
                  <TD>{m.hasAward ? <Badge tone="green">Already nominated</Badge> : <Badge tone="amber">Not yet nominated</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">The milestone years are set under Settings → HR policy.</p>
      </Section>

      <Section title="Awards the company gives" description="Switch an award off to stop new nominations; the ones already made are kept.">
        {types.length === 0 ? (
          <Empty>No awards yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Award</TH>
                <TH>Long-service year</TH>
                <TH>May be shown on the board</TH>
                <TH>Status</TH>
                {canConfigure && <TH />}
              </TR>
            </THead>
            <TBody>
              {types.map((t) => (
                <TR key={t.id} className={t.active ? "" : "opacity-60"}>
                  <TD>
                    {t.name}
                    {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                  </TD>
                  <TD>{t.longServiceYears ? `${t.longServiceYears} years` : "—"}</TD>
                  <TD>{t.mayAnnounce ? "Yes, if the recipient agrees" : "No"}</TD>
                  <TD>{t.active ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}</TD>
                  {canConfigure && (
                    <TD>
                      <ActionButton action={setAwardTypeActiveAction.bind(null, t.id, !t.active)} variant="outline">
                        {t.active ? "Switch off" : "Switch on"}
                      </ActionButton>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {canConfigure && (
          <div className="mt-3">
            <SmartForm
              columns={3}
              submitLabel="Add the award"
              action={addAwardTypeAction}
              fields={[
                { name: "name", label: "Award name", required: true, placeholder: "e.g. Employee of the quarter" },
                { name: "longServiceYears", label: "A long-service award for this many years (blank = not a long-service award)", type: "number", min: 1, max: 60 },
                { name: "mayAnnounce", label: "May be shown on the recognition board (the recipient must still agree)", type: "checkbox" },
                { name: "description", label: "What it is for (optional)", type: "textarea", span: 3 },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}
