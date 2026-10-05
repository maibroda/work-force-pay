import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import {
  adjustStock,
  createItem,
  createPack,
  getItem,
  inventorySummary,
  issueKit,
  issuePack,
  listItems,
  listPacks,
  outstandingKit,
  outstandingKitValue,
  receiveStock,
  removePackLine,
  returnKit,
  setPackActive,
  setPackLine,
  updateItem,
  writeOffStock,
} from "@/server/services/inventory";
import { approveExit, initiateExit } from "@/server/services/hr";
import { addKitRecovery, prepareSettlement, submitSettlement } from "@/server/services/settlements";
import { isolatedOrg } from "../helpers";

async function setup() {
  const t = await isolatedOrg();
  const ops = t.ctx("OPERATIONS");
  const emp = await createEmployee(t.ctx("HR_ADMIN"), { firstName: "Kit", lastName: "Holder", employmentDate: "2025-01-01", categoryId: t.guardId });
  const shirt = await createItem(ops, { name: "Uniform shirt", category: "UNIFORM", size: "L", unit: "pcs", reorderLevel: 5, openingQuantity: 10, openingUnitCost: 1000 });
  return { t, ops, emp, shirt };
}

describe("stock items and costing", () => {
  it("creates items with an opening balance, numbers them, and rejects duplicates and unauthorized users", async () => {
    const { t, ops, shirt } = await setup();
    expect(shirt.sku).toMatch(/^ITM-/);
    expect(shirt.quantityOnHand).toBe(10);
    expect(Number(shirt.averageCost)).toBe(1000);
    const item = await getItem(ops, shirt.id);
    expect(item!.movements).toHaveLength(1);
    expect(item!.movements[0]).toMatchObject({ type: "RECEIPT", stockDelta: 10, balanceAfter: 10 });

    await expect(createItem(ops, { name: "uniform SHIRT", category: "UNIFORM", size: "l", unit: "pcs", reorderLevel: 0 })).rejects.toThrow(/already in the stock list/);
    await expect(createItem(ops, { name: "Beret", category: "UNIFORM", unit: "pcs", reorderLevel: 0, openingQuantity: 5 })).rejects.toThrow(/unit cost/);
    await expect(createItem(t.ctx("AUDITOR"), { name: "Cap", category: "UNIFORM", unit: "pcs", reorderLevel: 0 })).rejects.toThrow();
    expect((await listItems(t.ctx("AUDITOR"))).length).toBe(1); // read-only access still works
    await expect(listItems(t.ctx("EMPLOYEE"))).rejects.toThrow();
  });

  it("recalculates a weighted-average cost on every receipt", async () => {
    const { ops, shirt } = await setup();
    const m = await receiveStock(ops, { itemId: shirt.id, quantity: 10, unitCost: 2000, reference: "DN-77" });
    expect(m.balanceAfter).toBe(20);
    const item = await getItem(ops, shirt.id);
    expect(Number(item!.averageCost)).toBe(1500); // (10 × 1,000 + 10 × 2,000) ÷ 20
    expect(item!.value).toBe(30000);
    await expect(receiveStock(ops, { itemId: shirt.id, quantity: 0, unitCost: 1 })).rejects.toThrow();
  });

  it("flags low stock against the reorder level, and a stocktake records the difference with a reason", async () => {
    const { ops, shirt } = await setup();
    expect((await listItems(ops, { lowOnly: true })).length).toBe(0); // 10 on hand vs reorder at 5
    await expect(adjustStock(ops, { itemId: shirt.id, countedQuantity: 10, reason: "Stocktake" })).rejects.toThrow(/nothing to adjust/);
    await expect(adjustStock(ops, { itemId: shirt.id, countedQuantity: 4, reason: "" })).rejects.toThrow();
    const m = await adjustStock(ops, { itemId: shirt.id, countedQuantity: 4, reason: "Stocktake 30 Sep — 6 missing" });
    expect(m).toMatchObject({ type: "ADJUSTMENT", stockDelta: -6, quantity: 6, balanceAfter: 4 });
    const low = await listItems(ops, { lowOnly: true });
    expect(low.map((i) => i.id)).toEqual([shirt.id]);
    await writeOffStock(ops, { itemId: shirt.id, quantity: 1, reason: "Moth damage" });
    expect((await getItem(ops, shirt.id))!.quantityOnHand).toBe(3);
    await expect(writeOffStock(ops, { itemId: shirt.id, quantity: 9, reason: "Too many" })).rejects.toThrow(/Only 3/);
  });
});

describe("issuing and returning kit", () => {
  it("issues to an employee, never below zero stock, and only to someone still employed", async () => {
    const { t, ops, emp, shirt } = await setup();
    const m = await issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 3, reference: "Induction" });
    expect(m).toMatchObject({ type: "ISSUE", stockDelta: -3, balanceAfter: 7 });
    await expect(issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 8 })).rejects.toThrow(/Only 7/);
    expect((await getItem(ops, shirt.id))!.quantityOnHand).toBe(7); // the refused issue changed nothing

    await updateItem(ops, shirt.id, { active: false });
    await expect(issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 1 })).rejects.toThrow(/switched off/);
    await updateItem(ops, shirt.id, { active: true });

    const leaver = await createEmployee(t.ctx("HR_ADMIN"), { firstName: "Gone", lastName: "Already", employmentDate: "2024-01-01", categoryId: t.guardId });
    await db.employee.update({ where: { id: leaver.id }, data: { status: "RESIGNED" } });
    await expect(issueKit(ops, { employeeId: leaver.id, itemId: shirt.id, quantity: 1 })).rejects.toThrow(/already left/);
    await expect(issueKit(t.ctx("PAYROLL_ADMIN"), { employeeId: emp.id, itemId: shirt.id, quantity: 1 })).rejects.toThrow(); // view-only
  });

  it("restocks only good returns, caps returns at what's held, and needs a reason for damaged or lost kit", async () => {
    const { ops, emp, shirt } = await setup();
    await issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 4 });
    await expect(returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 5, condition: "GOOD" })).rejects.toThrow(/holds 4/);
    await expect(returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 1, condition: "LOST" })).rejects.toThrow(/lost kit/);

    const good = await returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 1, condition: "GOOD" });
    expect(good).toMatchObject({ stockDelta: 1, balanceAfter: 7 });
    const bad = await returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 1, condition: "DAMAGED", reason: "Torn beyond repair" });
    expect(bad).toMatchObject({ stockDelta: 0, balanceAfter: 7 }); // back with us, but not back on the shelf
    expect((await outstandingKit(ops, emp.id))[0]).toMatchObject({ issued: 4, returned: 2, outstanding: 2 });
  });

  it("lets kit come back after the employee has left", async () => {
    const { ops, emp, shirt } = await setup();
    await issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 2 });
    await db.employee.update({ where: { id: emp.id }, data: { status: "RESIGNED" } });
    await returnKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 2, condition: "GOOD" });
    expect(await outstandingKit(ops, emp.id)).toHaveLength(0);
  });

  it("reports what is held and its value, leavers first, and rolls it up in the summary", async () => {
    const { t, ops, emp, shirt } = await setup();
    const boots = await createItem(ops, { name: "Boots", category: "FOOTWEAR", size: "42", unit: "pair", reorderLevel: 0, openingQuantity: 4, openingUnitCost: 5000 });
    await issueKit(ops, { employeeId: emp.id, itemId: shirt.id, quantity: 2 });
    await issueKit(ops, { employeeId: emp.id, itemId: boots.id, quantity: 1 });
    const v = await outstandingKitValue(t.org.id, emp.id);
    expect(v.items).toBe(3);
    expect(v.value).toBe(7000); // 2 × 1,000 + 1 × 5,000

    const leaver = await createEmployee(t.ctx("HR_ADMIN"), { firstName: "Left", lastName: "Holding", employmentDate: "2024-01-01", categoryId: t.guardId });
    await issueKit(ops, { employeeId: leaver.id, itemId: boots.id, quantity: 1 });
    await db.employee.update({ where: { id: leaver.id }, data: { status: "RESIGNED" } });
    const all = await outstandingKit(ops);
    expect(all[0].employee.id).toBe(leaver.id); // leavers sort first

    const s = await inventorySummary(ops);
    expect(s).toMatchObject({ itemCount: 2, holders: 2, leaversHolding: 1, heldValue: 12000 });
    expect(s.stockValue).toBe(8 * 1000 + 2 * 5000);
  });
});

describe("kit packs", () => {
  it("issues a whole pack or nothing, and reports how many sets the shelf can supply", async () => {
    const { t, ops, emp, shirt } = await setup();
    const boots = await createItem(ops, { name: "Boots", category: "FOOTWEAR", size: "42", unit: "pair", reorderLevel: 0, openingQuantity: 1, openingUnitCost: 5000 });
    const pack = await createPack(ops, { name: "Guard starter kit", categoryId: t.guardId });
    await expect(createPack(ops, { name: "guard STARTER kit" })).rejects.toThrow(/already exists/);
    await expect(issuePack(ops, emp.id, pack.id)).rejects.toThrow(/no items/);
    await setPackLine(ops, pack.id, { itemId: shirt.id, quantity: 2 });
    await setPackLine(ops, pack.id, { itemId: boots.id, quantity: 2 }); // only 1 pair in stock
    const [p] = await listPacks(ops);
    expect(p.setsAvailable).toBe(0); // boots limit it
    expect(p.unitValue).toBe(2 * 1000 + 2 * 5000);

    await expect(issuePack(ops, emp.id, pack.id)).rejects.toThrow(/Boots — 42: need 2, have 1/);
    expect((await getItem(ops, shirt.id))!.quantityOnHand).toBe(10); // the shirts weren't touched

    await setPackLine(ops, pack.id, { itemId: boots.id, quantity: 1 }); // changing the quantity updates the line
    const res = await issuePack(ops, emp.id, pack.id);
    expect(res.issued).toBe(2);
    expect((await getItem(ops, shirt.id))!.quantityOnHand).toBe(8);
    expect((await getItem(ops, boots.id))!.quantityOnHand).toBe(0);
    expect((await outstandingKit(ops, emp.id)).map((r) => r.outstanding).sort()).toEqual([1, 2]);

    const line = (await listPacks(ops))[0].lines[0];
    await removePackLine(ops, line.id);
    await setPackActive(ops, pack.id, false);
    await expect(issuePack(ops, emp.id, pack.id)).rejects.toThrow(/switched off/);
  });
});

describe("kit still held at exit", () => {
  async function leaver(t: Awaited<ReturnType<typeof isolatedOrg>>, name: string) {
    const hr = t.ctx("HR_ADMIN");
    const e = await createEmployee(hr, { firstName: name, lastName: "Leaver", employmentDate: "2025-01-01", categoryId: t.guardId });
    return { e, exitFor: async () => {
      const exit = await initiateExit(hr, { employeeId: e.id, exitType: "RESIGNATION", noticeDate: "2027-01-01", lastWorkingDate: "2027-01-31", reason: "Moving to another city" });
      await approveExit(hr, exit.id);
      return prepareSettlement(t.ctx("PAYROLL_ADMIN"), exit.id, { monthlyGrossOverride: 100000 });
    } };
  }

  it("is added to the leaver's settlement as a recovery, once, and only while it's a draft", async () => {
    const { t, ops, shirt } = await setup();
    const prep = t.ctx("PAYROLL_ADMIN");
    const holder = await leaver(t, "Holder");
    await issueKit(ops, { employeeId: holder.e.id, itemId: shirt.id, quantity: 3 }); // issued while still employed
    const s = await holder.exitFor();

    await expect(addKitRecovery(t.ctx("AUDITOR"), s.id)).rejects.toThrow();
    const line = await addKitRecovery(prep, s.id);
    expect(line).toMatchObject({ kind: "DEDUCTION", code: "RECOVERY", manual: true });
    expect(Number(line.amount)).toBe(3000);
    expect(line.description).toMatch(/3 item/);
    await expect(addKitRecovery(prep, s.id)).rejects.toThrow(/already on this settlement/);

    await submitSettlement(prep, s.id);
    await expect(addKitRecovery(prep, s.id)).rejects.toThrow(/draft/);
  });

  it("refuses when the leaver holds nothing", async () => {
    const { t } = await setup();
    const clean = await leaver(t, "Clean");
    const s = await clean.exitFor();
    await expect(addKitRecovery(t.ctx("PAYROLL_ADMIN"), s.id)).rejects.toThrow(/isn't holding any/);
  });
});
