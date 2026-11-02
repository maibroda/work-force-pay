import { describe, expect, it } from "vitest";
import { remittanceTiming } from "@/server/services/payments";
import { isolatedOrg } from "../helpers";

const row = (id: string, type: string, payee: string, status = "PENDING") => ({ id, type, payee, status, totalAmount: 250000, run: { taxRuleVersion: null, period: { year: 2027, month: 11 } } });

describe("the remittance schedule gives pension a due date: the end of the pay month", () => {
  it("dates each pension line (one per PFA) and leaves other kinds of remittance without a date", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const rows = [row("p1", "PENSION", "Stanbic IBTC Pension"), row("p2", "PENSION", "ARM Pension"), row("p3", "PENSION", "ARM Pension", "PAID"), row("i1", "ITF", "Industrial Training Fund")];
    const on = await remittanceTiming(fin, rows, "2027-11-30");
    expect(on.get("p1")).toMatchObject({ dueDate: "2027-11-30", overdue: false, penalty: null });
    const late = await remittanceTiming(fin, rows, "2027-12-02");
    expect(late.get("p1")).toMatchObject({ dueDate: "2027-11-30", overdue: true, daysLate: 2, penalty: null });
    expect(late.get("p2")).toMatchObject({ overdue: true });
    expect(late.get("p3")).toMatchObject({ dueDate: "2027-11-30", overdue: false }); // paid is never late
    expect(late.has("i1")).toBe(false); // other kinds have no date until the adviser says so
  });
});
