"use server";
import { act } from "./_run";
import * as fixedAssets from "@/server/services/fixed-assets";

type V = Record<string, unknown>;
const PATHS = ["/finance/fixed-assets"];

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
