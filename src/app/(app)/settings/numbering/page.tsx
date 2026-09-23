import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listNumberingRules, formatNumber } from "@/server/services/numbering";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { updateNumberingAction } from "@/app/actions/workforce";

export default async function NumberingPage() {
  const ctx = await requirePage("employee.view");
  const rules = await listNumberingRules(ctx);
  const manage = can(ctx.role, "settings.manage");
  return (
    <>
      <PageHeader
        title="Numbering rules"
        description="Employee numbers are generated automatically from this rule (e.g. EMP-000125 or HSC-EMP-000001). Numbers are unique per organization (database constraint) and never change on transfer."
      />
      <Section title="Rules" flush>
        <Table>
          <THead>
            <TR>
              <TH>Entity</TH>
              <TH>Prefix</TH>
              <TH>Separator</TH>
              <TH>Digits</TH>
              <TH>Next number</TH>
              <TH>Next value</TH>
              {manage && <TH>Edit</TH>}
            </TR>
          </THead>
          <TBody>
            {rules.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.entity}</TD>
                <TD>{r.prefix}</TD>
                <TD>{r.separator}</TD>
                <TD>{r.digits}</TD>
                <TD>{r.nextNumber}</TD>
                <TD>
                  <code>{formatNumber(r, r.nextNumber)}</code>
                </TD>
                {manage && (
                  <TD className="min-w-[520px]">
                    <SmartForm
                      columns={3}
                      resetOnSuccess={false}
                      submitLabel="Update"
                      fields={[
                        { name: "entity", label: "", type: "hidden", defaultValue: r.entity },
                        { name: "prefix", label: "Prefix", defaultValue: r.prefix },
                        { name: "separator", label: "Separator", defaultValue: r.separator },
                        {
                          name: "digits",
                          label: "Digits",
                          type: "number",
                          required: true,
                          min: 1,
                          max: 12,
                          defaultValue: r.digits,
                        },
                        {
                          name: "nextNumber",
                          label: "Next number",
                          type: "number",
                          required: true,
                          min: 1,
                          defaultValue: r.nextNumber,
                        },
                      ]}
                      action={updateNumberingAction}
                    />
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
