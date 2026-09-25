import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { assetRegister, CATEGORIES } from "@/server/services/fixed-assets";
import { options, enumOptions } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createFixedAssetAction, postDepreciationForMonthAction } from "@/app/actions/fixed-assets";

export default async function FixedAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "payment.manage");
  const [register, opts] = await Promise.all([assetRegister(ctx, sp.asOf), options(ctx)]);

  return (
    <>
      <PageHeader
        title="Fixed asset register"
        description="Vehicles, radios, CCTV, firearms, office & IT equipment. Depreciation is straight-line, computed as of the date below — nothing here is a stored schedule that needs re-running."
      />

      <FilterBar>
        <FilterField label="As of">
          <Input type="date" name="asOf" defaultValue={sp.asOf ?? iso(new Date())} />
        </FilterField>
      </FilterBar>

      <StatGrid cols={3}>
        <Stat label="Total cost (active assets)" value={naira(register.totals.cost)} />
        <Stat label="Accumulated depreciation" value={naira(register.totals.accumulatedDepreciation)} tone="amber" />
        <Stat label="Net book value" value={naira(register.totals.netBookValue)} tone="green" />
      </StatGrid>

      <Section title="By category" flush description="Active assets only, as of the date above.">
        <Table>
          <THead>
            <TR>
              <TH>Category</TH>
              <TH className="text-right">Assets</TH>
              <TH className="text-right">Cost</TH>
              <TH className="text-right">Accumulated depreciation</TH>
              <TH className="text-right">Net book value</TH>
            </TR>
          </THead>
          <TBody>
            {register.byCategory.map((r) => (
              <TR key={r.category}>
                <TD>{r.category.replace(/_/g, " ")}</TD>
                <TD className="text-right">{r.count}</TD>
                <TD className="text-right">{naira(r.cost)}</TD>
                <TD className="text-right">{naira(r.accumulatedDepreciation)}</TD>
                <TD className="text-right font-medium">{naira(r.netBookValue)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!register.byCategory.length && <Empty>No active assets.</Empty>}
      </Section>

      <Section title="Assets" flush>
        <Table>
          <THead>
            <TR>
              <TH>Asset</TH>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>Assigned to</TH>
              <TH>Acquired</TH>
              <TH className="text-right">Cost</TH>
              <TH className="text-right">Net book value</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {register.rows.map((a) => (
              <TR key={a.id} className={a.status === "DISPOSED" ? "opacity-60" : ""}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/fixed-assets/${a.id}`}>
                    {a.assetNumber}
                  </Link>
                </TD>
                <TD>{a.name}</TD>
                <TD>
                  <Badge tone="blue">{a.category.replace(/_/g, " ")}</Badge>
                </TD>
                <TD className="text-xs">
                  {a.assignedToEmployee
                    ? `${a.assignedToEmployee.employeeNumber} — ${a.assignedToEmployee.firstName} ${a.assignedToEmployee.lastName}`
                    : a.locationDescription || "—"}
                </TD>
                <TD>{fmtDate(a.acquisitionDate)}</TD>
                <TD className="text-right">{naira(a.cost)}</TD>
                <TD className="text-right font-medium">{naira(a.netBookValue)}</TD>
                <TD>
                  <StatusBadge status={a.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!register.rows.length && <Empty>No fixed assets recorded yet.</Empty>}
      </Section>

      {manage && (
        <FormPanel title="Post depreciation for a month">
          <p className="mb-3 text-sm text-muted-foreground">
            Posts one journal (Dr Depreciation Expense / Cr Accumulated Depreciation) for every
            active asset&apos;s incremental depreciation that month. Blocked from running twice for
            the same month.
          </p>
          <SmartForm
            columns={3}
            submitLabel="Post depreciation"
            action={postDepreciationForMonthAction}
            fields={[
              {
                name: "month",
                label: "Month",
                type: "select",
                required: true,
                options: Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-US", { month: "long" }),
                })),
                defaultValue: String(new Date().getUTCMonth() + 1),
              },
              {
                name: "year",
                label: "Year",
                type: "number",
                required: true,
                defaultValue: new Date().getUTCFullYear(),
              },
            ]}
          />
        </FormPanel>
      )}

      {manage && (
        <FormPanel title="Add a fixed asset">
          <SmartForm
            columns={3}
            resetOnSuccess
            submitLabel="Record asset"
            action={createFixedAssetAction}
            fields={[
              { name: "name", label: "Asset name", required: true, placeholder: "Toyota Hilux — LSD 234 AB" },
              {
                name: "category",
                label: "Category",
                type: "select",
                required: true,
                options: enumOptions(CATEGORIES),
                defaultValue: "OTHER",
              },
              { name: "serialNumber", label: "Serial / VIN / plate number" },
              {
                name: "costCenterId",
                label: "Cost center (optional)",
                type: "select",
                options: opts.costCenters,
              },
              {
                name: "assignedToEmployeeId",
                label: "Assigned to (optional)",
                type: "select",
                options: opts.employees,
              },
              { name: "locationDescription", label: "Location (if not assigned to staff)" },
              {
                name: "acquisitionDate",
                label: "Acquisition date",
                type: "date",
                required: true,
                defaultValue: iso(new Date()),
              },
              { name: "cost", label: "Cost (₦)", type: "number", required: true, min: 1 },
              {
                name: "usefulLifeMonths",
                label: "Useful life (months)",
                type: "number",
                required: true,
                min: 1,
                defaultValue: 60,
              },
              { name: "salvageValue", label: "Salvage value (₦)", type: "number", defaultValue: 0 },
              { name: "notes", label: "Notes", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
