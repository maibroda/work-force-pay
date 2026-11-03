import { requirePage } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dates";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/lib/entitlements/catalogue";
import { listPriceBooks } from "@/server/services/price-book";
import { Empty, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPriceBookAction, deletePriceBookDraftAction, verifyPriceBookAction } from "@/app/actions/price-book";

const BASIS: Record<string, string> = { active_employee: "per employee per month", crm_user: "per user per month", flat: "flat per month" };
const pricedModules = MODULE_KEYS.filter((k) => k !== "core" && MODULES[k].status !== "planned") as ModuleKey[];

/** Platform staff only. The book starts empty: every amount is entered here by you, and a second person verifies each version before any quote can use it. */
export default async function PriceBookPage() {
  const ctx = await requirePage("pricebook.manage");
  const books = await listPriceBooks(ctx);
  return (
    <>
      <PageHeader
        title="Software price book"
        description="What each module costs per month, as dated versions. Nothing is priced until you enter it. A second person verifies each version, and a verified version can never be changed: a price change is a new version from a later date. Quotes use only the verified version in force on their day. The app calculates prices; it never charges anyone."
      />
      <Section title="Add a version" description="Leave a price empty for no price set: a quote that includes a module with no price shows no total. The core is included in every plan and has no price.">
        <SmartForm
          columns={3}
          submitLabel="Save as a draft"
          action={createPriceBookAction}
          fields={[
            { name: "effectiveFrom", label: "Starts on", type: "date", required: true },
            { name: "minimumMonthly", label: "Minimum monthly fee (naira)", placeholder: "0.00" },
            { name: "note", label: "Note" },
            ...pricedModules.map((k) => ({ name: `price_${k}`, label: `${MODULES[k].name} (${BASIS[MODULES[k].chargedPer] ?? MODULES[k].chargedPer})`, placeholder: "no price set" })),
          ]}
        />
      </Section>
      <Section title="Versions" description="Newest first." flush>
        {books.length === 0 ? (
          <Empty>No version yet. The price book is empty.</Empty>
        ) : (
          books.map((b) => (
            <div key={b.id} className="border-b p-4 last:border-b-0">
              <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                <b>Starts {fmtDate(b.effectiveFrom)}</b>
                <StatusBadge status={b.verifiedAt ? "ACTIVE" : "PENDING"} />
                <span>{b.verifiedAt ? `Verified by ${b.verifiedBy}` : "Draft: not used by any quote yet"}</span>
                <span className="text-muted-foreground">
                  {b.currency}, minimum {b.minimumMonthly.toFixed(2)}, made by {b.createdBy}
                  {b.note ? `: ${b.note}` : ""}
                </span>
                {!b.verifiedAt && b.createdByUserId !== ctx.userId && (
                  <ActionButton action={verifyPriceBookAction.bind(null, b.id)} confirm="Verify this version? It can never be changed afterwards.">
                    Verify
                  </ActionButton>
                )}
                {!b.verifiedAt && b.createdByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Someone else must verify it.</span>}
                {!b.verifiedAt && (
                  <ActionButton action={deletePriceBookDraftAction.bind(null, b.id)} confirm="Delete this draft?" variant="outline">
                    Delete draft
                  </ActionButton>
                )}
              </div>
              {b.lines.length === 0 ? (
                <p className="text-xs text-muted-foreground">No prices in this version.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Module</TH>
                      <TH>Charged</TH>
                      <TH>Price</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {b.lines.map((l) => (
                      <TR key={l.id}>
                        <TD>{MODULES[l.moduleKey as ModuleKey]?.name ?? l.moduleKey}</TD>
                        <TD>{BASIS[l.basis] ?? l.basis}</TD>
                        <TD>{l.amount.toFixed(2)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          ))
        )}
      </Section>
    </>
  );
}
