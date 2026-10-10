import { describe, expect, it } from "vitest";
import { allocationProblems, autoAllocate, invoiceStatus, receiptPosition } from "@/lib/receipts";
import { AGE_BUCKETS, bucketFor, buildStatement, daysPastDue, statementCsv, type StatementInvoice, type StatementSettlement } from "@/lib/statements";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const inv = (id: string, due: string, balance: number) => ({ id, invoiceNumber: id.toUpperCase(), dueDate: day(due), balance });

describe("autoAllocate", () => {
  const open = [inv("b", "2026-08-30", 4_000_000), inv("a", "2026-07-30", 4_000_000), inv("c", "2026-09-30", 4_000_000)];

  it("fills the oldest due first, up to what each owes, and leaves the rest unapplied", () => {
    expect(autoAllocate(open, 10_000_000, 0)).toEqual([
      { invoiceId: "a", cash: 4_000_000, wht: 0 },
      { invoiceId: "b", cash: 4_000_000, wht: 0 },
      { invoiceId: "c", cash: 2_000_000, wht: 0 },
    ]);
    expect(autoAllocate(open, 1_000_000, 0)).toEqual([{ invoiceId: "a", cash: 1_000_000, wht: 0 }]);
    expect(autoAllocate(open, 20_000_000, 0).reduce((s, a) => s + a.cash, 0)).toBe(12_000_000); // 8,000,000 would be held
  });

  it("applies withheld tax first on each invoice, then cash", () => {
    expect(autoAllocate(open, 3_500_000, 500_000)).toEqual([{ invoiceId: "a", cash: 3_500_000, wht: 500_000 }]);
  });

  it("works to the kobo", () => {
    const out = autoAllocate([inv("a", "2026-07-30", 100.1), inv("b", "2026-08-30", 0.2)], 100.2, 0);
    expect(out).toEqual([{ invoiceId: "a", cash: 100.1, wht: 0 }, { invoiceId: "b", cash: 0.1, wht: 0 }]);
  });
});

describe("allocationProblems", () => {
  const invoices = new Map([["a", { invoiceNumber: "INV-A", balance: 4_000_000 }], ["b", { invoiceNumber: "INV-B", balance: 1_000_000 }]]);
  const room = { cash: 5_000_000, wht: 0 };

  it("accepts allocations that fit", () => {
    expect(allocationProblems([{ invoiceId: "a", cash: 4_000_000, wht: 0 }, { invoiceId: "b", cash: 1_000_000, wht: 0 }], invoices, room, true)).toEqual([]);
    expect(allocationProblems([], invoices, room, true)).toEqual([]); // all held as an advance
  });

  it("says what is wrong", () => {
    expect(allocationProblems([{ invoiceId: "a", cash: 4_000_001, wht: 0 }], invoices, room, true).join(" ")).toMatch(/INV-A: 4000001\.00 is more than the 4000000\.00 still owed/);
    expect(allocationProblems([{ invoiceId: "a", cash: 4_000_000, wht: 0 }, { invoiceId: "b", cash: 1_000_001, wht: 0 }], invoices, room, true).join(" ")).toMatch(/INV-B/);
    expect(allocationProblems([{ invoiceId: "a", cash: 3_000_000, wht: 0 }, { invoiceId: "b", cash: 1_000_000, wht: 0 }], invoices, { cash: 3_500_000, wht: 0 }, true).join(" ")).toMatch(/Cash applied \(4000000\.00\) is more than the 3500000\.00/);
    expect(allocationProblems([{ invoiceId: "zz", cash: 1, wht: 0 }], invoices, room, true).join(" ")).toMatch(/isn't open for this client/);
    expect(allocationProblems([{ invoiceId: "a", cash: 1, wht: 0 }, { invoiceId: "a", cash: 1, wht: 0 }], invoices, room, true).join(" ")).toMatch(/INV-A appears twice/);
    expect(allocationProblems([{ invoiceId: "a", cash: -1, wht: 0 }], invoices, room, true).join(" ")).toMatch(/can't be negative/);
  });

  it("insists that all tax withheld is applied when a receipt is recorded, and allows part later", () => {
    const withTax = { cash: 3_500_000, wht: 500_000 };
    expect(allocationProblems([{ invoiceId: "a", cash: 3_500_000, wht: 500_000 }], invoices, withTax, true)).toEqual([]);
    expect(allocationProblems([{ invoiceId: "a", cash: 3_500_000, wht: 0 }], invoices, withTax, true).join(" ")).toMatch(/All of the tax withheld \(500000\.00\) has to be applied/);
    expect(allocationProblems([], invoices, withTax, true).join(" ")).toMatch(/has to be applied to the invoices/);
    expect(allocationProblems([{ invoiceId: "a", cash: 1_000_000, wht: 0 }], invoices, withTax, false)).toEqual([]);
    expect(allocationProblems([{ invoiceId: "a", cash: 1, wht: 600_000 }], invoices, withTax, false).join(" ")).toMatch(/Tax withheld applied \(600000\.00\) is more than the 500000\.00/);
  });
});

describe("receiptPosition and invoiceStatus", () => {
  it("counts what is left of the cash and the tax, after applications and refunds", () => {
    const p = receiptPosition({ amount: 5_000_000, whtWithheld: 200_000 }, [{ cash: 3_000_000, wht: 200_000 }, { cash: 500_000, wht: 0 }], 750_000);
    expect(p).toEqual({ cashApplied: 3_500_000, whtApplied: 200_000, cashLeft: 750_000, whtLeft: 0, held: 750_000 });
  });
  it("sets an invoice's status from what has settled it", () => {
    expect(invoiceStatus(100, 0, 0)).toBe("ISSUED");
    expect(invoiceStatus(100, 40, 0)).toBe("PARTIALLY_PAID");
    expect(invoiceStatus(100, 90, 10)).toBe("PAID");
    expect(invoiceStatus(100.1, 100.1, 0)).toBe("PAID");
  });
});

describe("ageing buckets", () => {
  it("puts an amount in a bucket by days past its due date", () => {
    const due = day("2026-08-31");
    expect(bucketFor(due, day("2026-08-31"))).toBe(AGE_BUCKETS[0]);
    expect(bucketFor(due, day("2026-09-01"))).toBe("1–30 days");
    expect(bucketFor(due, day("2026-09-30"))).toBe("1–30 days");
    expect(bucketFor(due, day("2026-10-01"))).toBe("31–60 days");
    expect(bucketFor(due, day("2026-10-30"))).toBe("31–60 days");
    expect(bucketFor(due, day("2026-10-31"))).toBe("61–90 days");
    expect(bucketFor(due, day("2026-11-29"))).toBe("61–90 days");
    expect(bucketFor(due, day("2026-11-30"))).toBe("Over 90 days");
    expect(daysPastDue(due, day("2026-08-01"))).toBe(-30);
  });
});

describe("buildStatement", () => {
  const invoices: StatementInvoice[] = [
    { id: "a", invoiceNumber: "INV-A", invoiceDate: day("2026-06-30"), dueDate: day("2026-07-30"), total: 1000 },
    { id: "b", invoiceNumber: "INV-B", invoiceDate: day("2026-07-31"), dueDate: day("2026-08-30"), total: 2000 },
  ];
  const settlements: StatementSettlement[] = [
    { id: "r1", invoiceId: "a", date: day("2026-08-01"), kind: "RECEIPT", reference: "RCT-1", amount: 900 },
    { id: "r2", invoiceId: "a", date: day("2026-08-01"), kind: "TAX_WITHHELD", reference: "RCT-1", amount: 100 },
    { id: "r3", invoiceId: "b", date: day("2026-09-01"), kind: "RECEIPT", reference: "RCT-2", amount: 500, reversedOn: day("2026-09-10") },
  ];

  it("keeps a running balance that ends where the per-invoice balances add up", () => {
    const s = buildStatement(invoices, settlements, 0, day("2026-09-05"));
    expect(s.lines.map((l) => l.balance)).toEqual([1000, 3000, 2100, 2000, 1500]);
    expect(s.closing).toBe(1500);
    expect(s.lines.at(-1)!.balance).toBe(s.closing);
    expect(s.outstanding.map((o) => [o.invoiceNumber, o.balance, o.bucket])).toEqual([["INV-B", 1500, "1–30 days"]]);
  });

  it("counts a reversed settlement until the day it was reversed", () => {
    expect(buildStatement(invoices, settlements, 0, day("2026-09-05")).closing).toBe(1500);
    expect(buildStatement(invoices, settlements, 0, day("2026-09-10")).closing).toBe(2000); // taken back
  });

  it("is as at a date: later invoices and settlements aren't there yet", () => {
    const s = buildStatement(invoices, settlements, 0, day("2026-07-15"));
    expect([s.lines.length, s.closing]).toEqual([1, 1000]);
    expect(s.ageing["Not yet due"]).toBe(1000);
  });

  it("nets advances against what is owed, and writes a CSV", () => {
    const s = buildStatement(invoices, settlements, 300, day("2026-09-05"));
    expect([s.closing, s.advances, s.net]).toEqual([1500, 300, 1200]);
    const csv = statementCsv('Acme "Ltd"', day("2026-09-05"), s);
    expect(csv).toContain('"Acme ""Ltd"""');
    expect(csv).toContain('"Net owed",,,,,,1200.00');
  });
});
