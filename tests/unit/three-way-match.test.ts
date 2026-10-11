import { describe, expect, it } from "vitest";
import { matchBill, matchStatusFor, noOrderException, receiptProgress } from "@/lib/three-way-match";

const order = [
  { id: "a", description: "Radios", quantity: 10, rate: 15000 },
  { id: "b", description: "Chargers", quantity: 2, rate: 5000 },
];

describe("three-way match rules", () => {
  it("matches a bill that agrees with the order and the goods received", () => {
    const e = matchBill({
      orderLines: order,
      received: { a: 10, b: 2 },
      billLines: [
        { orderLineId: "a", description: "Radios", quantity: 10, rate: 15000 },
        { orderLineId: "b", description: "Chargers", quantity: 2, rate: 5000 },
      ],
    });
    expect(e).toEqual([]);
    expect(matchStatusFor(true, e)).toBe("MATCHED");
  });

  it("flags billing for more than was received, naming what was received", () => {
    const e = matchBill({ orderLines: order, received: { a: 6 }, billLines: [{ orderLineId: "a", description: "Radios", quantity: 10, rate: 15000 }] });
    expect(e.map((x) => x.code)).toEqual(["NOT_RECEIVED"]);
    expect(e[0].message).toMatch(/billed 10, received 6/);
    expect(matchStatusFor(true, e)).toBe("EXCEPTION");
  });

  it("says nothing was received when that is the case", () => {
    const e = matchBill({ orderLines: order, received: {}, billLines: [{ orderLineId: "b", description: "Chargers", quantity: 2, rate: 5000 }] });
    expect(e[0].message).toMatch(/nothing received/);
  });

  it("flags more than ordered, even when it was all received", () => {
    const e = matchBill({ orderLines: order, received: { a: 12 }, billLines: [{ orderLineId: "a", description: "Radios", quantity: 12, rate: 15000 }] });
    expect(e.map((x) => x.code)).toEqual(["OVER_ORDERED"]);
  });

  it("allows a price up to the tolerance above the order and no more, and a lower price is fine", () => {
    const bill = (rate: number) => matchBill({ orderLines: order, received: { a: 10 }, billLines: [{ orderLineId: "a", description: "Radios", quantity: 10, rate }] });
    expect(bill(15150)).toEqual([]); // exactly 1% above
    expect(bill(15151).map((x) => x.code)).toEqual(["PRICE_OVER"]);
    expect(bill(14000)).toEqual([]);
    expect(matchBill({ orderLines: order, received: { a: 10 }, billLines: [{ orderLineId: "a", description: "Radios", quantity: 10, rate: 15500 }], tolerance: { pricePct: 5, qtyPct: 0 } })).toEqual([]);
  });

  it("applies the quantity tolerance to what was received", () => {
    const bill = (qty: number, qtyPct: number) =>
      matchBill({ orderLines: order, received: { a: 10 }, billLines: [{ orderLineId: "a", description: "Radios", quantity: qty, rate: 15000 }], tolerance: { pricePct: 1, qtyPct } }).map((x) => x.code);
    expect(bill(10.5, 5)).toEqual([]); // exactly 5% over
    expect(bill(10.6, 5)).toEqual(["OVER_ORDERED", "NOT_RECEIVED"]);
    expect(bill(10.5, 0)).toEqual(["OVER_ORDERED", "NOT_RECEIVED"]);
  });

  it("flags a bill line that is not on the order", () => {
    const e = matchBill({ orderLines: order, received: {}, billLines: [{ description: "Courier fee", quantity: 1, rate: 2000 }] });
    expect(e.map((x) => x.code)).toEqual(["UNORDERED_LINE"]);
  });

  it("totals several bill lines for the same order line", () => {
    const e = matchBill({
      orderLines: order,
      received: { a: 10 },
      billLines: [
        { orderLineId: "a", description: "Radios", quantity: 6, rate: 15000 },
        { orderLineId: "a", description: "Radios (second drop)", quantity: 6, rate: 15000 },
      ],
    });
    expect(e.map((x) => x.code)).toContain("NOT_RECEIVED");
  });

  it("holds a bill with no order at or above the limit, and every non-zero bill when the limit is zero", () => {
    expect(noOrderException(499999.99, 500000)).toBeNull();
    expect(noOrderException(500000, 500000)?.code).toBe("NO_ORDER_OVER_LIMIT");
    expect(noOrderException(1, 0)?.code).toBe("NO_ORDER_OVER_LIMIT");
    expect(noOrderException(0, 0)).toBeNull();
    expect(matchStatusFor(false, [])).toBe("NOT_REQUIRED");
  });

  it("reports how much of an order has been received", () => {
    expect(receiptProgress([{ quantity: 10, received: 0 }])).toBe("NONE");
    expect(receiptProgress([{ quantity: 10, received: 4 }, { quantity: 2, received: 2 }])).toBe("PARTIAL");
    expect(receiptProgress([{ quantity: 10, received: 10 }, { quantity: 2, received: 2 }])).toBe("FULL");
  });
});
