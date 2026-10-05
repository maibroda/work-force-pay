"use server";
import { act } from "./_run";
import * as inv from "@/server/services/inventory";
import * as eos from "@/server/services/settlements";

type V = Record<string, unknown>;
const PATHS = ["/inventory", "/employees", "/hr", "/payroll/settlements"];

export async function createItemAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const i = await inv.createItem(ctx, v as never);
    return { message: `${i.sku} added to the stock list.`, redirectTo: `/inventory/${i.id}` };
  }, PATHS);
}
export async function updateItemAction(id: string, v: V) {
  return act("inventory.manage", async (ctx) => {
    await inv.updateItem(ctx, id, v as never);
    return { message: "Item updated." };
  }, PATHS);
}
export async function toggleItemAction(id: string, active: boolean) {
  return act("inventory.manage", async (ctx) => {
    await inv.updateItem(ctx, id, { active });
    return { message: active ? "Item switched on." : "Item switched off — it can't be issued." };
  }, PATHS);
}
export async function receiveStockAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const m = await inv.receiveStock(ctx, v as never);
    return { message: `Received — ${m.balanceAfter} now on hand.` };
  }, PATHS);
}
export async function adjustStockAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const m = await inv.adjustStock(ctx, v as never);
    return { message: `Stock adjusted by ${m.stockDelta > 0 ? "+" : ""}${m.stockDelta} — ${m.balanceAfter} now on hand.` };
  }, PATHS);
}
export async function writeOffStockAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const m = await inv.writeOffStock(ctx, v as never);
    return { message: `Written off — ${m.balanceAfter} now on hand.` };
  }, PATHS);
}
export async function issueKitAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const m = await inv.issueKit(ctx, v as never);
    return { message: `Issued — ${m.balanceAfter} left in stock.` };
  }, PATHS);
}
export async function issuePackAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    const r = await inv.issuePack(ctx, String(v.employeeId ?? ""), String(v.packId ?? ""));
    return { message: `${r.pack.name} issued — ${r.issued} item type(s).` };
  }, PATHS);
}
export async function returnKitAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    await inv.returnKit(ctx, v as never);
    return { message: "Kit taken back." };
  }, PATHS);
}
/** One-click return of everything outstanding for a row; a reason is collected for damaged / lost. */
export async function returnHeldAction(employeeId: string, itemId: string, quantity: number, condition: string, reason?: string) {
  return act("inventory.manage", async (ctx) => {
    await inv.returnKit(ctx, { employeeId, itemId, quantity, condition: condition as never, reason });
    return { message: condition === "GOOD" ? "Returned to stock." : `Recorded as ${condition.toLowerCase()}.` };
  }, PATHS);
}
export async function createPackAction(v: V) {
  return act("inventory.manage", async (ctx) => {
    await inv.createPack(ctx, v as never);
    return { message: "Kit pack created — now add its items." };
  }, PATHS);
}
export async function setPackLineAction(packId: string, v: V) {
  return act("inventory.manage", async (ctx) => {
    await inv.setPackLine(ctx, packId, v as never);
    return { message: "Pack updated." };
  }, PATHS);
}
export async function removePackLineAction(lineId: string) {
  return act("inventory.manage", async (ctx) => {
    await inv.removePackLine(ctx, lineId);
    return { message: "Removed from the pack." };
  }, PATHS);
}
export async function setPackActiveAction(id: string, active: boolean) {
  return act("inventory.manage", async (ctx) => {
    await inv.setPackActive(ctx, id, active);
    return { message: active ? "Pack switched on." : "Pack switched off." };
  }, PATHS);
}
export async function addKitRecoveryAction(settlementId: string) {
  return act("settlement.manage", async (ctx) => {
    await eos.addKitRecovery(ctx, settlementId);
    return { message: "Unreturned kit added as a recovery." };
  }, PATHS);
}
