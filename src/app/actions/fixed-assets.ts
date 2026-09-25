"use server";
import { act } from "./_run";
import * as fixedAssets from "@/server/services/fixed-assets";

type V = Record<string, unknown>;
const PATHS = ["/finance/fixed-assets", "/accounting/journals"];

export async function createFixedAssetAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const asset = await fixedAssets.createFixedAsset(ctx, v as never);
      return { message: `Asset ${asset.assetNumber} recorded.` };
    },
    PATHS,
  );
}

export async function disposeFixedAssetAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await fixedAssets.disposeFixedAsset(ctx, String(v.id), v as never);
      return { message: "Asset disposed." };
    },
    PATHS,
  );
}

export async function postDepreciationForMonthAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const journal = await fixedAssets.postDepreciationForMonth(ctx, Number(v.year), Number(v.month));
      return { message: `Depreciation posted — journal ${journal.entryNumber}.` };
    },
    PATHS,
  );
}
