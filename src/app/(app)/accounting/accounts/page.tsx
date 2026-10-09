import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { chartTree } from "@/server/services/accounting";
import { CLASS_NAMES, STATEMENT_LINES } from "@/lib/standard-chart";
import { fmtDate } from "@/lib/dates";
import { enumOptions } from "@/server/options";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createAccountAction, createCategoryAction, createGroupAction, installStandardChartAction, setAccountActiveAction, updateAccountAction } from "@/app/actions/accounting";

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const statementOptions = Object.entries(STATEMENT_LINES).map(([value, label]) => ({ value, label }));

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const { tree, unclassified, total } = await chartTree(ctx);
  const manage = can(ctx.role, "gl.manage");

  const q = (sp.q ?? "").trim().toLowerCase();
  const wantClass = sp.class ? Number(sp.class) : null;
  const status = sp.status ?? "all";
  type Row = (typeof unclassified)[number];
  const keep = (a: Row) => (!q || a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) && (status === "all" || (status === "active" ? a.active : !a.active));

  const categoryOptions = tree.flatMap((g) => g.categories.map((c) => ({ value: c.id, label: `${g.classNumber} · ${g.name} › ${c.name}` })));
  const parentOptions = [...tree.flatMap((g) => g.categories.flatMap((c) => c.accounts)), ...unclassified].map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  const groupOptions = tree.map((g) => ({ value: g.id, label: `${g.classNumber} · ${g.code} ${g.name}` }));

  const accountRow = (a: Row, inheritedLine: string | null) => {
    const line = a.statementLine ?? inheritedLine;
    return (
      <TR key={a.id}>
        <TD className="font-mono" style={{ paddingLeft: `${0.75 + a.depth * 1.25}rem` }}>
          {a.depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
          {a.code}
        </TD>
        <TD>
          {a.name}
          {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
        </TD>
        <TD className="text-xs">{a.type}</TD>
        <TD className="max-w-[16rem] whitespace-normal text-xs text-muted-foreground">
          {line ? STATEMENT_LINES[line] ?? line : "—"}
          {a.taxMapping && <Badge tone="blue">{a.taxMapping}</Badge>}
        </TD>
        <TD className="space-x-1 whitespace-normal text-xs">
          {a.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
          {!a.postable && <Badge tone="amber">Header</Badge>}
          {(a.effectiveFrom || a.effectiveTo) && (
            <span className="text-muted-foreground">
              {a.effectiveFrom ? `from ${fmtDate(a.effectiveFrom)}` : ""} {a.effectiveTo ? `to ${fmtDate(a.effectiveTo)}` : ""}
            </span>
          )}
        </TD>
        <TD className="whitespace-nowrap text-right">
          {manage && (
            <div className="flex items-center justify-end gap-2">
              <details className="relative text-left">
                <summary className="cursor-pointer rounded-md border border-input px-2 py-1 text-xs hover:bg-accent">Edit</summary>
                <div className="absolute right-0 z-10 mt-1 w-[26rem] rounded-md border bg-card p-3 shadow-lg">
                  <SmartForm
                    columns={1}
                    submitLabel="Save"
                    resetOnSuccess={false}
                    action={updateAccountAction.bind(null, a.id)}
                    fields={[
                      { name: "name", label: "Name", defaultValue: a.name },
                      { name: "categoryId", label: "Category", type: "select", options: categoryOptions, defaultValue: a.categoryId ?? undefined, help: "Where it sits in the chart. The account's code and type never change." },
                      { name: "parentId", label: "Sub-account of", type: "select", options: parentOptions.filter((p) => p.value !== a.id), defaultValue: a.parentId ?? undefined, help: "The parent becomes a header you can't post to, so it must have no postings." },
                      { name: "statementLine", label: "Financial-statement line", type: "select", options: statementOptions, defaultValue: a.statementLine ?? undefined, help: "Leave blank to use the category's." },
                      { name: "taxMapping", label: "Tax mapping", defaultValue: a.taxMapping ?? undefined, help: "e.g. VAT_OUTPUT, WHT_RECEIVABLE, PAYE." },
                      { name: "effectiveFrom", label: "Usable from", type: "date", defaultValue: a.effectiveFrom ? a.effectiveFrom.toISOString().slice(0, 10) : undefined },
                      { name: "effectiveTo", label: "Usable until", type: "date", defaultValue: a.effectiveTo ? a.effectiveTo.toISOString().slice(0, 10) : undefined },
                      { name: "description", label: "Description", defaultValue: a.description ?? undefined },
                    ]}
                  />
                </div>
              </details>
              <ActionButton action={setAccountActiveAction.bind(null, a.id, !a.active)} variant="outline">
                {a.active ? "Deactivate" : "Activate"}
              </ActionButton>
            </div>
          )}
        </TD>
      </TR>
    );
  };

  const head = (
    <THead>
      <TR>
        <TH>Code</TH>
        <TH>Name</TH>
        <TH>Type</TH>
        <TH>Reports under</TH>
        <TH>Status</TH>
        <TH />
      </TR>
    </THead>
  );

  // Only what matches the filters is shown: a class or group with nothing in it is dropped, so a search never leaves empty headings.
  const filtering = !!q || status !== "all";
  const classes = [1, 2, 3, 4, 5, 6, 7]
    .filter((n) => !wantClass || wantClass === n)
    .map((n) => ({
      n,
      groups: tree
        .filter((g) => g.classNumber === n)
        .map((g) => ({ ...g, categories: g.categories.map((c) => ({ ...c, accounts: c.accounts.filter(keep) })).filter((c) => c.accounts.length || !filtering) }))
        .filter((g) => g.categories.length),
    }))
    .filter((c) => c.groups.length);
  const shownUnclassified = wantClass ? [] : unclassified.filter(keep);

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="Accounts are organised as class → group → category → account, with sub-accounts under any account. A header account (one with sub-accounts) groups its sub-accounts and can't be posted to. An account's code and type never change, because they are on posted journals; where it sits, what it reports under and when it can be used can. The accounts payroll, billing, payables and depreciation post to keep their codes."
      />
      {manage && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <ActionButton action={installStandardChartAction} confirm="Install the standard chart? It adds the groups, categories and any missing accounts, and places your existing accounts in categories. Nothing already set up is renamed, retyped or recoded." variant="outline">
            Install the standard chart
          </ActionButton>
          <span className="text-xs text-muted-foreground">Safe to run again. {unclassified.length ? `${unclassified.length} account(s) aren't in a category yet.` : "Every account is in a category."}</span>
        </div>
      )}
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" placeholder="Code or name" defaultValue={sp.q} />
        </FilterField>
        <FilterField label="Class">
          <Select name="class" defaultValue={sp.class ?? ""}>
            <option value="">All classes</option>
            {Object.entries(CLASS_NAMES).map(([n, name]) => (
              <option key={n} value={n}>
                {n} · {name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={status}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </FilterField>
      </FilterBar>

      {manage && (
        <FormPanel title="Add an account">
          <SmartForm
            columns={3}
            submitLabel="Add account"
            action={createAccountAction}
            fields={[
              { name: "code", label: "Account code", required: true, placeholder: "e.g. 6210" },
              { name: "name", label: "Account name", required: true },
              { name: "type", label: "Type", type: "select", required: true, options: enumOptions(TYPES) },
              { name: "categoryId", label: "Category", type: "select", options: categoryOptions, help: "The type must suit the category's class." },
              { name: "parentId", label: "Sub-account of (optional)", type: "select", options: parentOptions },
              { name: "statementLine", label: "Financial-statement line (optional)", type: "select", options: statementOptions },
              { name: "taxMapping", label: "Tax mapping (optional)" },
              { name: "effectiveFrom", label: "Usable from (optional)", type: "date" },
              { name: "effectiveTo", label: "Usable until (optional)", type: "date" },
            ]}
          />
        </FormPanel>
      )}
      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <FormPanel title="Add a group">
            <SmartForm
              columns={3}
              submitLabel="Add group"
              action={createGroupAction}
              fields={[
                { name: "classNumber", label: "Class", type: "select", required: true, options: Object.entries(CLASS_NAMES).map(([value, name]) => ({ value, label: `${value} · ${name}` })) },
                { name: "code", label: "Code", required: true, placeholder: "e.g. G6500" },
                { name: "name", label: "Name", required: true },
              ]}
            />
          </FormPanel>
          <FormPanel title="Add a category">
            <SmartForm
              columns={3}
              submitLabel="Add category"
              action={createCategoryAction}
              fields={[
                { name: "groupId", label: "Group", type: "select", required: true, options: groupOptions },
                { name: "code", label: "Code", required: true, placeholder: "e.g. C6510" },
                { name: "name", label: "Name", required: true },
                { name: "statementLine", label: "Reports under", type: "select", options: statementOptions, span: 3 },
              ]}
            />
          </FormPanel>
        </div>
      )}

      {classes.map(({ n, groups }) => (
        <section key={n} className="mb-6">
          <h2 className="mb-2 text-base font-semibold">
            {n} · {CLASS_NAMES[n]}
          </h2>
          {groups.map((g) => {
            return (
              <Section key={g.id} title={`${g.code} · ${g.name}`} flush>
                {g.categories.map((c) => (
                  <div key={c.id}>
                    <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
                      {c.code} · {c.name}
                      {c.statementLine && <span className="ml-2 font-normal text-muted-foreground">reports under {STATEMENT_LINES[c.statementLine] ?? c.statementLine}</span>}
                    </div>
                    {c.accounts.length ? (
                      <Table>
                        {head}
                        <TBody>{c.accounts.map((a) => accountRow(a, c.statementLine))}</TBody>
                      </Table>
                    ) : (
                      <div className="px-3 py-2 text-xs text-muted-foreground">No accounts yet.</div>
                    )}
                  </div>
                ))}
              </Section>
            );
          })}
        </section>
      ))}

      {shownUnclassified.length > 0 && (
        <Section title={`Not in a category yet (${shownUnclassified.length})`} flush>
          <Table>
            {head}
            <TBody>{shownUnclassified.map((a) => accountRow(a, null))}</TBody>
          </Table>
        </Section>
      )}
      {!total && <Empty>No accounts.</Empty>}
      {!!total && !classes.length && !shownUnclassified.length && <Empty>No account matches those filters.</Empty>}
    </>
  );
}
