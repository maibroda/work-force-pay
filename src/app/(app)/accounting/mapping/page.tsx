import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listAccounts, listMappings, unmappedHeads } from "@/server/services/accounting";
import { enumOptions } from "@/server/options";
import { PageHeader, Section } from "@/components/page";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { saveMappingAction } from "@/app/actions/accounting";

const HEAD_TYPES = ["EARNING", "DEDUCTION", "EMPLOYER", "NET_PAY"];
const EXPLAIN: Record<string, string> = {
  EARNING: "Debited to an expense account",
  DEDUCTION: "Credited to a liability (or receivable) account",
  EMPLOYER: "Debited to expense and credited to a payable",
  NET_PAY: "Credited with each period's total net pay",
};

export default async function MappingPage() {
  const ctx = await requirePage("gl.view");
  const [mappings, accounts, unmapped] = await Promise.all([
    listMappings(ctx),
    listAccounts(ctx),
    unmappedHeads(ctx),
  ]);
  const manage = can(ctx.role, "gl.manage");
  const acctOptions = accounts
    .filter((a) => a.active)
    .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  const fields = (
    m?: (typeof mappings)[number],
    head?: { code: string; name: string; type: string },
  ): Field[] => [
    m || head
      ? { name: "headCode", label: "Head code", type: "hidden", defaultValue: m?.headCode ?? head!.code }
      : { name: "headCode", label: "Head code", required: true, placeholder: "e.g. HAZARD" },
    { name: "headName", label: "Head name", required: true, defaultValue: m?.headName ?? head?.name },
    {
      name: "headType",
      label: "Type",
      type: "select",
      required: true,
      options: enumOptions(HEAD_TYPES),
      defaultValue: m?.headType ?? head?.type,
    },
    {
      name: "debitAccountId",
      label: "Debit account",
      type: "select",
      options: acctOptions,
      defaultValue: m?.debitAccountId ?? "",
      help: "Earnings and employer costs.",
    },
    {
      name: "creditAccountId",
      label: "Credit account",
      type: "select",
      options: acctOptions,
      defaultValue: m?.creditAccountId ?? "",
      help: "Deductions, employer payables and net pay.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Payroll GL mapping"
        description="Every payroll head posts to its own general-ledger account when a payroll is locked or its period closed. Earnings debit an expense; deductions credit a liability; net pay credits Net Salaries Payable."
      />
      {unmapped.length > 0 && (
        <Section
          title={`${unmapped.length} payroll head(s) without a mapping`}
          description="These appear on payslips but have no account of their own. Until mapped they post to the default 'Other' account."
        >
          <div className="space-y-3">
            {unmapped.map((h) => (
              <div key={h.code} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">
                  <code>{h.code}</code> — {h.name} <Badge tone="amber">{h.type}</Badge>
                </p>
                {manage ? (
                  <SmartForm
                    columns={3}
                    submitLabel="Map head"
                    action={saveMappingAction}
                    fields={fields(undefined, h)}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Ask Finance to map this head.</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title={`${mappings.length} mapped heads`} flush>
        <ul className="divide-y">
          {mappings.map((m) => (
            <li key={m.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/40">
                  <span className="w-40 font-mono text-xs font-semibold">{m.headCode}</span>
                  <span className="w-44">{m.headName}</span>
                  <Badge
                    tone={m.headType === "EARNING" ? "blue" : m.headType === "DEDUCTION" ? "amber" : "violet"}
                  >
                    {m.headType.replace("_", " ")}
                  </Badge>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {m.debitAccount && (
                      <>
                        Dr <b className="font-mono">{m.debitAccount.code}</b> {m.debitAccount.name}
                      </>
                    )}
                    {m.debitAccount && m.creditAccount && " · "}
                    {m.creditAccount && (
                      <>
                        Cr <b className="font-mono">{m.creditAccount.code}</b> {m.creditAccount.name}
                      </>
                    )}
                  </span>
                  {manage && <span className="text-xs text-primary group-open:hidden">Edit</span>}
                </summary>
                {manage && (
                  <div className="border-t bg-muted/20 p-4">
                    <p className="mb-3 text-xs text-muted-foreground">{EXPLAIN[m.headType]}.</p>
                    <SmartForm
                      columns={3}
                      submitLabel="Save mapping"
                      resetOnSuccess={false}
                      action={saveMappingAction}
                      fields={fields(m)}
                    />
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      </Section>
      {manage && (
        <Section
          title="Map another head"
          description="For a custom salary component or a new deduction type."
        >
          <SmartForm columns={3} submitLabel="Save mapping" action={saveMappingAction} fields={fields()} />
        </Section>
      )}
    </>
  );
}
