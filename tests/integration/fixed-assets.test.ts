import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import {
  accumulatedDepreciation,
  assetRegister,
  createFixedAsset,
  disposeFixedAsset,
  monthlyDepreciation,
  netBookValue,
} from "@/server/services/fixed-assets";
import { createCostCenter } from "@/server/services/cost-centers";
import { ctxFor, employeeByNumber, uid } from "../helpers";

describe("fixed asset register", () => {
  it("records an asset with an auto-number, and only 'payment.manage' can create one", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const tag = uid();

    await expect(
      createFixedAsset(auditor, {
        name: `Toyota Hilux ${tag}`,
        category: "VEHICLE",
        acquisitionDate: "2026-01-01",
        cost: 15000000,
        usefulLifeMonths: 60,
      }),
    ).rejects.toThrow();

    await expect(
      createFixedAsset(fin, {
        name: `Bad Salvage ${tag}`,
        category: "OTHER",
        acquisitionDate: "2026-01-01",
        cost: 100000,
        usefulLifeMonths: 12,
        salvageValue: 100000, // must be strictly less than cost
      }),
    ).rejects.toThrow(/less than the acquisition cost/);

    const asset = await createFixedAsset(fin, {
      name: `Toyota Hilux ${tag}`,
      category: "VEHICLE",
      acquisitionDate: "2026-01-01",
      cost: 15000000,
      usefulLifeMonths: 60,
      salvageValue: 1500000,
    });
    expect(asset.assetNumber).toMatch(/^FA-/);
    expect(asset.status).toBe("ACTIVE");
  });

  it("computes straight-line monthly/accumulated depreciation, capped at useful life, and links cost center + assigned employee", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const cc = await createCostCenter(admin, { code: `FA-${tag}`, name: `Fleet ${tag}` });
    const emp = await employeeByNumber(fin, "EMP-000025");

    const asset = await createFixedAsset(fin, {
      name: `Depreciation Test Asset ${tag}`,
      category: "IT_EQUIPMENT",
      costCenterId: cc.id,
      assignedToEmployeeId: emp.id,
      acquisitionDate: "2026-01-15",
      cost: 1200000,
      usefulLifeMonths: 12,
      salvageValue: 0,
    });
    expect(asset.costCenterId).toBe(cc.id);
    expect(asset.assignedToEmployeeId).toBe(emp.id);

    const monthly = monthlyDepreciation(asset);
    expect(monthly).toBe(100000); // 1,200,000 / 12

    // Acquisition month (Jan) counts as month 1 — day-of-month is ignored.
    expect(accumulatedDepreciation(asset, new Date("2026-01-31T00:00:00.000Z"))).toBe(100000);
    expect(accumulatedDepreciation(asset, new Date("2026-03-01T00:00:00.000Z"))).toBe(300000);
    // Fully depreciated at 12 months, and never exceeds the depreciable base beyond that.
    expect(accumulatedDepreciation(asset, new Date("2027-06-01T00:00:00.000Z"))).toBe(1200000);
    expect(netBookValue(asset, new Date("2027-06-01T00:00:00.000Z"))).toBe(0);

    const register = await assetRegister(fin, "2026-03-01");
    const row = register.rows.find((r) => r.id === asset.id)!;
    expect(row.accumulatedDepreciation).toBe(300000);
    expect(row.netBookValue).toBe(900000);
    const category = register.byCategory.find((c) => c.category === "IT_EQUIPMENT")!;
    expect(category.netBookValue).toBeGreaterThanOrEqual(900000); // may include other IT assets from other tests
  });

  it("disposal freezes depreciation at the disposal date, is terminal, and validates dates", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const asset = await createFixedAsset(fin, {
      name: `Disposal Test Asset ${tag}`,
      category: "OFFICE_EQUIPMENT",
      acquisitionDate: "2026-01-01",
      cost: 600000,
      usefulLifeMonths: 24,
      salvageValue: 0,
    });

    await expect(
      disposeFixedAsset(fin, asset.id, {
        disposalDate: "2025-12-01", // before acquisition
        disposalProceeds: 0,
        disposalReason: "Testing invalid date",
      }),
    ).rejects.toThrow(/before the acquisition date/);

    const disposed = await disposeFixedAsset(fin, asset.id, {
      disposalDate: "2026-07-01",
      disposalProceeds: 200000,
      disposalReason: "Sold — replaced with newer model",
    });
    expect(disposed.status).toBe("DISPOSED");

    // Depreciation is frozen at the disposal date even when asked "as of" a much later date.
    const atDisposal = accumulatedDepreciation(disposed, new Date("2026-07-01T00:00:00.000Z"));
    const wayAfter = accumulatedDepreciation(disposed, new Date("2028-01-01T00:00:00.000Z"));
    expect(wayAfter).toBe(atDisposal);

    await expect(
      disposeFixedAsset(fin, asset.id, {
        disposalDate: "2026-08-01",
        disposalProceeds: 0,
        disposalReason: "Already disposed, should fail",
      }),
    ).rejects.toThrow(/already been disposed/);

    const fromDb = await db.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(num(fromDb.disposalProceeds)).toBe(200000);
  });
});
