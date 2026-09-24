import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import {
  accumulatedDepreciation,
  getFixedAsset,
  monthlyDepreciation,
  netBookValue,
} from "@/server/services/fixed-assets";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num, round2 } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { disposeFixedAssetAction } from "@/app/actions/fixed-assets";

export default async function FixedAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const asset = await getFixedAsset(ctx, id);
  if (!asset) notFound();
  const manage = can(ctx.role, "payment.manage");
  const asOf = new Date();
  const monthly = monthlyDepreciation(asset);
  const accum = accumulatedDepreciation(asset, asset.status === "DISPOSED" ? (asset.disposalDate ?? asOf) : asOf);
  const nbv = netBookValue(asset, asset.status === "DISPOSED" ? (asset.disposalDate ?? asOf) : asOf);

  return (
    <>
      <PageHeader
        title={`${asset.assetNumber} — ${asset.name}`}
        crumbs={[{ href: "/finance/fixed-assets", label: "Fixed asset register" }]}
      />

      <Section title="Asset details">
        <KV
          cols={2}
          items={[
            ["Category", asset.category.replace(/_/g, " ")],
            ["Status", <StatusBadge key="s" status={asset.status} />],
            ["Serial / VIN / plate number", asset.serialNumber ?? "—"],
            ["Cost center", asset.costCenter?.name ?? "—"],
            [
              "Assigned to",
              asset.assignedToEmployee
                ? `${asset.assignedToEmployee.employeeNumber} — ${asset.assignedToEmployee.firstName} ${asset.assignedToEmployee.lastName}`
                : (asset.locationDescription ?? "—"),
            ],
            ["Acquisition date", fmtDate(asset.acquisitionDate)],
            ["Cost", naira(asset.cost)],
            ["Useful life", `${asset.usefulLifeMonths} months`],
            ["Salvage value", naira(asset.salvageValue)],
            ["Monthly depreciation", naira(monthly)],
            ["Accumulated depreciation", naira(accum)],
            ["Net book value", <b key="nbv">{naira(nbv)}</b>],
          ]}
        />
        {asset.notes && (
          <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{asset.notes}</p>
        )}
      </Section>

      {asset.status === "DISPOSED" && (
        <Section title="Disposal">
          <KV
            cols={2}
            items={[
              ["Disposal date", fmtDate(asset.disposalDate)],
              ["Disposal proceeds", naira(asset.disposalProceeds)],
              [
                "Gain / (loss) on disposal",
                naira(round2(num(asset.disposalProceeds) - nbv)),
              ],
              ["Reason", asset.disposalReason ?? "—"],
            ]}
          />
        </Section>
      )}

      {manage && asset.status === "ACTIVE" && (
        <Section
          title="Dispose of this asset"
          description="Terminal — an asset can't be re-activated once disposed. Depreciation freezes at the disposal date."
        >
          <SmartForm
            columns={3}
            submitLabel="Dispose asset"
            action={disposeFixedAssetAction}
            fields={[
              { name: "id", label: "", type: "hidden", defaultValue: asset.id },
              {
                name: "disposalDate",
                label: "Disposal date",
                type: "date",
                required: true,
                defaultValue: iso(new Date()),
              },
              { name: "disposalProceeds", label: "Disposal proceeds (₦)", type: "number", defaultValue: 0 },
              { name: "disposalReason", label: "Reason", required: true, span: 1 },
            ]}
          />
        </Section>
      )}
    </>
  );
}
