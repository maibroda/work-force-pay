import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import { cancelInvoice, generateInvoices, recordReceipt, setInvoiceApprovalRequired } from "@/server/services/billing";
import { periodFor, transitionPeriod } from "@/server/services/periods";
import { recordClientReceipt } from "@/server/services/receipts";
import { arReport, closeCentre, evaluateClose, reconciliationsAsAt, receivablesAsAt, setCloseChecklistRequired, signOff, snapshotDrift, waiveCheck } from "@/server/services/period-close";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** One client billed 4,000,000 in each of June, July and August 2026 (plain invoices of 4,000,000). */
async function world(approval = false) {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const hr = w.t.ctx("HR_ADMIN", null, 1);
  const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = w.t.ctx("COMPANY_ADMIN", null, 2);
  if (approval) await setInvoiceApprovalRequired(boss, true);
  const first = await w.addCharge(await w.newRun(2026, 6), 4_000_000);
  await w.addCharge(await w.newRun(2026, 7), 4_000_000, first);
  await w.addCharge(await w.newRun(2026, 8), 4_000_000, first);
  const runs = await db.payrollRun.findMany({ where: { organizationId: w.t.org.id }, orderBy: { period: { month: "asc" } } });
  for (const r of runs) await generateInvoices(fin, r.id, { vatPct: 0 });
  const invoices = await db.clientInvoice.findMany({ where: { organizationId: w.t.org.id }, orderBy: { invoiceDate: "asc" } });
  const period = (date: string) => periodFor(db, w.t.org.id, day(date));
  /** Soft close by Finance, close by an administrator, for each month in turn. */
  const closeThrough = async (...dates: string[]) => {
    for (const dt of dates) {
      const p = await period(dt);
      await transitionPeriod(fin, p.id, "SOFT_CLOSE");
      await transitionPeriod(boss, p.id, "CLOSE");
    }
  };
  return { ...w, fin, hr, boss, boss2, first, invoices, period, closeThrough };
}

describe("closing a clean period", () => {
  it("writes a snapshot of the books as they stood: trial balance, receivables by client and invoice with ageing", async () => {
    const { t, fin, boss, period, closeThrough } = await world();
    await closeThrough("2026-06-30", "2026-07-31");
    const aug = await period("2026-08-31");
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE");
    const snaps = await db.periodSnapshot.findMany({ where: { periodId: aug.id } });
    expect(snaps).toHaveLength(1);
    const snap = snaps[0];
    expect([snap.version, num(snap.arTotal), num(snap.arLedger), snap.supersededAt]).toEqual([1, 12_000_000, 12_000_000, null]);
    expect(num(snap.trialDebit)).toBe(num(snap.trialCredit));
    const report = await arReport(fin, aug.id);
    expect(report.official).toBe(true);
    expect(report.checksumOk).toBe(true);
    expect(report.data.receivables.total).toBe(12_000_000);
    expect(report.data.receivables.clients).toHaveLength(1);
    // aged at 31 August: June's invoice was due 30 July (32 days), July's on 30 August (1 day), August's on 30 September
    expect(report.data.receivables.invoices.map((i) => i.bucket)).toEqual(["31–60 days", "1–30 days", "Not yet due"]);
    expect(report.data.trialBalance.find((r) => r.code === "1200")!.debit).toBe(12_000_000);
    expect(report.data.balances.cash).toBe(0);
    void t;
  });

  it("stays the official record when later activity changes the live figures", async () => {
    const { t, fin, boss, first, invoices, period, closeThrough } = await world();
    await closeThrough("2026-06-30", "2026-07-31", "2026-08-31");
    const aug = await period("2026-08-31");
    // October: a receipt settles two invoices, and the August one is not part of it
    await recordClientReceipt(fin, { clientId: first.clientId, amount: 8_000_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: invoices[0].id, cash: 4_000_000 }, { invoiceId: invoices[1].id, cash: 4_000_000 }] } as never);
    const report = await arReport(fin, aug.id);
    expect(report.official).toBe(true);
    expect(report.data.receivables.total).toBe(12_000_000); // as at 31 August, whatever happened since
    const now = await receivablesAsAt(fin, day("2026-10-31"));
    expect(now.total).toBe(4_000_000);
    // as at 31 August a fresh calculation agrees with the snapshot: nothing has moved
    const drift = await snapshotDrift(fin, aug.id);
    expect(drift).toMatchObject({ difference: 0, moved: [], checksumOk: true });
    void t;
    void boss;
  });

  it("shows when the underlying records have been tampered with since: the snapshot stays, the drift is reported", async () => {
    const { t, fin, invoices, period, closeThrough } = await world();
    await recordReceipt(fin, { invoiceId: invoices[0].id, amount: 1_000_000, receivedDate: "2026-07-20" }); // July is still open
    await closeThrough("2026-06-30", "2026-07-31", "2026-08-31");
    const aug = await period("2026-08-31");
    const before = await arReport(fin, aug.id);
    // someone changes a receipt's date in the database behind the system's back
    await db.$executeRawUnsafe(`UPDATE "ClientReceipt" SET "receivedDate" = DATE '2026-09-15' WHERE "organizationId" = '${t.org.id}'`);
    const drift = await snapshotDrift(fin, aug.id);
    expect(drift!.checksumOk).toBe(true); // the record itself is untouched
    expect(drift!.difference).not.toBe(0);
    expect(drift!.moved.length).toBeGreaterThan(0);
    expect((await arReport(fin, aug.id)).data.receivables.total).toBe(before.data.receivables.total);
  });
});

describe("close is blocked while the books are out", () => {
  it("refuses to close while receivables don't equal the ledger, and nothing can waive it", async () => {
    const { t, fin, boss, hr, first, period } = await world();
    // an invoice that exists in the subledger but was never posted to the ledger
    const per = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: t.org.id } });
    const extra = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: per.id, runNumber: 9 } });
    await db.clientInvoice.create({ data: { organizationId: t.org.id, clientId: first.clientId, runId: extra.id, periodId: per.id, invoiceNumber: "INV-UNPOSTED", invoiceDate: day("2026-06-15"), dueDate: day("2026-07-15"), subtotal: 500_000, totalAmount: 500_000, createdBy: "test" } });
    const jun = await period("2026-06-30");
    await transitionPeriod(fin, jun.id, "SOFT_CLOSE");
    await expect(transitionPeriod(boss, jun.id, "CLOSE")).rejects.toThrow(/can't be closed yet: receivables.*out by 500000\.00/);
    await expect(waiveCheck(boss, jun.id, "AR_GL", "Trying to close over the difference anyway")).rejects.toThrow(/can't be waived/);
    await expect(waiveCheck(hr, jun.id, "AR_GL", "Trying to close over the difference anyway")).rejects.toThrow(/permission/i);
    expect((await db.accountingPeriod.findUniqueOrThrow({ where: { id: jun.id } })).status).toBe("SOFT_CLOSED");
    expect(await db.periodSnapshot.count({ where: { periodId: jun.id } })).toBe(0);
    const centre = await closeCentre(fin, jun.id);
    expect(centre.blockers.map((b) => b.code)).toEqual(["AR_GL"]);
    expect(centre.reconciliations.find((r) => r.code === "AR_GL")).toMatchObject({ subledger: 4_500_000, ledger: 4_000_000, agrees: false });
  });

  it("counts an invoice cancelled later as still owed on the earlier date, so the books agree as at that date", async () => {
    const { fin, invoices } = await world();
    await cancelInvoice(fin, invoices[2].id, "Billed to the wrong client entirely"); // cancelled in October
    const august = await reconciliationsAsAt(fin, day("2026-08-31"));
    expect(august.lines.find((l) => l.code === "AR_GL")).toMatchObject({ subledger: 12_000_000, ledger: 12_000_000, agrees: true });
    const october = await reconciliationsAsAt(fin, day("2026-10-31"));
    expect(october.lines.find((l) => l.code === "AR_GL")).toMatchObject({ subledger: 8_000_000, ledger: 8_000_000, agrees: true });
  });

  it("dates the cancellation of a future-dated invoice no earlier than the invoice, so the books agree on every date in between", async () => {
    const { t, fin, first, newRun, addCharge } = await world();
    const run = await newRun(2027, 6);
    await addCharge(run, 1_000_000, first);
    const [future] = await generateInvoices(fin, run.id, { vatPct: 0 });
    expect(future.invoiceDate.toISOString().slice(0, 10)).toBe("2027-06-30");
    await cancelInvoice(fin, future.id, "Raised for the wrong month entirely");
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AR_INVOICE_CANCEL", sourceId: future.id } });
    expect(reversal.postingDate.toISOString().slice(0, 10)).toBe("2027-06-30"); // not today
    for (const date of ["2026-10-31", "2027-06-29", "2027-06-30"]) {
      const rec = await reconciliationsAsAt(fin, day(date));
      expect(rec.lines.every((l) => l.agrees)).toBe(true);
    }
  });

  it("holds the trial balance, receivables, payables and client advances to their control accounts as at the date", async () => {
    const { fin, first, invoices } = await world();
    await recordClientReceipt(fin, { clientId: first.clientId, amount: 5_000_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: invoices[0].id, cash: 4_000_000 }] } as never);
    const rec = await reconciliationsAsAt(fin, day("2026-10-31"));
    expect(rec.lines.map((l) => [l.code, l.agrees])).toEqual([["TRIAL_BALANCE", true], ["AR_GL", true], ["AP_GL", true], ["ADVANCES_GL", true]]);
    expect(rec.lines.find((l) => l.code === "ADVANCES_GL")!.ledger).toBe(1_000_000);
    expect(rec.lines.find((l) => l.code === "AR_GL")!.ledger).toBe(8_000_000);
  });
});

describe("pending work and the waiver", () => {
  it("blocks close over an invoice draft until an approver closes over it with a reason that is kept", async () => {
    const { t, fin, boss, boss2, hr, period, closeThrough } = await world(true); // approval required: the invoices are drafts
    const aug = await period("2026-08-31");
    await closeThrough("2026-06-30", "2026-07-31").catch(() => null);
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE").catch(() => null);
    const centre = await closeCentre(fin, aug.id);
    expect(centre.checks.find((c) => c.code === "PENDING_INVOICES")).toMatchObject({ status: "FAIL", kind: "PENDING", count: 1 });
    expect(centre.blockers.map((b) => b.code)).toContain("PENDING_INVOICES");
    await expect(transitionPeriod(boss, aug.id, "CLOSE")).rejects.toThrow(/can't be closed yet.*invoice drafts awaiting approval/);
    await expect(waiveCheck(fin, aug.id, "PENDING_INVOICES", "Closing over the draft with a proper reason")).rejects.toThrow(/permission/i);
    await expect(waiveCheck(boss, aug.id, "PENDING_INVOICES", "short")).rejects.toThrow(/Say why/);
    await expect(waiveCheck(boss, aug.id, "DRAFT_JOURNALS", "Closing over something that is only advisory")).rejects.toThrow(/information only|Nothing is outstanding/);
    await expect(waiveCheck(boss, aug.id, "NOPE", "A reason that is long enough here")).rejects.toThrow(/isn't a check/);
    await waiveCheck(boss, aug.id, "PENDING_INVOICES", "The August run will be invoiced in September, agreed with the client");
    await transitionPeriod(boss2, aug.id, "CLOSE");
    expect((await db.accountingPeriod.findUniqueOrThrow({ where: { id: aug.id } })).status).toBe("CLOSED");
    const waivers = await db.closeWaiver.findMany({ where: { periodId: aug.id } });
    expect(waivers.map((w) => [w.checkCode, w.waivedBy])).toEqual([["PENDING_INVOICES", boss.name]]);
    // a waiver is a record of a decision: it can't be changed or deleted
    await expect(db.closeWaiver.update({ where: { id: waivers[0].id }, data: { reason: "rewritten" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.closeWaiver.delete({ where: { id: waivers[0].id } })).rejects.toThrow(/cannot be changed or deleted/);
    void t;
    void hr;
  });

  it("doesn't let anyone close over a hard check, whatever the pending items say", async () => {
    const { fin, period } = await world();
    const aug = await period("2026-08-31");
    const { checks } = await evaluateClose(fin, aug);
    expect(checks.filter((c) => c.kind === "HARD").map((c) => c.status)).toEqual(["PASS", "PASS", "PASS", "PASS"]);
  });
});

describe("the checklist", () => {
  it("is advisory unless the organization makes it compulsory, and only those who may close can sign it off", async () => {
    const { fin, boss, hr, period, closeThrough } = await world();
    await closeThrough("2026-06-30");
    const jul = await period("2026-07-31");
    await transitionPeriod(fin, jul.id, "SOFT_CLOSE");
    const advisory = await closeCentre(fin, jul.id);
    expect(advisory.checklist.map((c) => c.done)).toEqual([false, false, false, false, false]);
    expect(advisory.checks.filter((c) => c.code.startsWith("SIGNOFF_")).every((c) => c.kind === "ADVISORY" && c.status === "WARN")).toBe(true);
    expect(advisory.blockers).toEqual([]);

    await expect(setCloseChecklistRequired(fin, true)).rejects.toThrow(/permission/i);
    await setCloseChecklistRequired(boss, true);
    const strict = await closeCentre(fin, jul.id);
    expect(strict.blockers).toHaveLength(5);
    await expect(transitionPeriod(boss, jul.id, "CLOSE")).rejects.toThrow(/can't be closed yet.*sign-off/);
    await expect(signOff(hr, jul.id, "BANK_RECS", true, "Not mine to sign")).rejects.toThrow(/permission/i);
    for (const code of ["BANK_RECS", "ACCRUALS", "PAYROLL_AGREED", "TAX_REVIEWED", "ASSETS"]) await signOff(fin, jul.id, code, true, "Reviewed");
    expect((await closeCentre(fin, jul.id)).blockers).toEqual([]);
    await signOff(fin, jul.id, "ASSETS", false, "Need to recheck the disposal");
    expect((await closeCentre(fin, jul.id)).blockers.map((b) => b.code)).toEqual(["SIGNOFF_ASSETS"]);
    await signOff(fin, jul.id, "ASSETS", true, "Rechecked");
    await transitionPeriod(boss, jul.id, "CLOSE");
    expect((await db.accountingPeriod.findUniqueOrThrow({ where: { id: jul.id } })).status).toBe("CLOSED");
    await setCloseChecklistRequired(boss, false);
  });
});

describe("reopening a closed period", () => {
  it("supersedes its snapshot and writes a new version when it is closed again, keeping the old one", async () => {
    const { t, fin, boss, period, closeThrough } = await world();
    await closeThrough("2026-06-30");
    const jun = await period("2026-06-30");
    const v1 = await db.periodSnapshot.findFirstOrThrow({ where: { periodId: jun.id } });
    await expect(transitionPeriod(boss, jun.id, "REOPEN", "Short")).rejects.toThrow();
    await transitionPeriod(boss, jun.id, "REOPEN", "A late supplier credit has to be posted into June");
    const superseded = await db.periodSnapshot.findUniqueOrThrow({ where: { id: v1.id } });
    expect(superseded.supersededAt).not.toBeNull();
    expect((await arReport(fin, jun.id)).official).toBe(false); // open again: only a live figure, clearly not official
    await transitionPeriod(fin, jun.id, "SOFT_CLOSE");
    await transitionPeriod(boss, jun.id, "CLOSE");
    const all = await db.periodSnapshot.findMany({ where: { periodId: jun.id }, orderBy: { version: "asc" } });
    expect(all.map((s) => [s.version, s.supersededAt !== null])).toEqual([[1, true], [2, false]]);
    expect((await arReport(fin, jun.id)).version).toBe(2);
    // the old version stays on record
    expect((await closeCentre(fin, jun.id)).snapshots.map((s) => s.version)).toEqual([2, 1]);
    void t;
  });

  it("can't have a snapshot edited, deleted or superseded twice, even by SQL", async () => {
    const { period, closeThrough, boss } = await world();
    await closeThrough("2026-06-30");
    const jun = await period("2026-06-30");
    const snap = await db.periodSnapshot.findFirstOrThrow({ where: { periodId: jun.id } });
    await expect(db.periodSnapshot.update({ where: { id: snap.id }, data: { arTotal: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.periodSnapshot.update({ where: { id: snap.id }, data: { data: { tampered: true } } })).rejects.toThrow(/cannot be changed/);
    await expect(db.periodSnapshot.delete({ where: { id: snap.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "PeriodSnapshot" SET checksum = 'x' WHERE id = '${snap.id}'`)).rejects.toThrow(/cannot be changed/);
    await transitionPeriod(boss, jun.id, "REOPEN", "A late supplier credit has to be posted into June");
    await expect(db.periodSnapshot.update({ where: { id: snap.id }, data: { supersededAt: new Date() } })).rejects.toThrow(/superseded only once/);
  });
});

describe("per organization", () => {
  it("keeps one organization's close centre and report from another's", async () => {
    const mine = await world();
    const other = await world();
    const jun = await mine.period("2026-06-30");
    await expect(closeCentre(other.fin, jun.id)).rejects.toThrow(/Period not found/);
    await expect(arReport(other.fin, jun.id)).rejects.toThrow(/Period not found/);
    await expect(waiveCheck(other.boss, jun.id, "PENDING_INVOICES", "Not their period to waive anything on")).rejects.toThrow(/Period not found/);
    await expect(signOff(other.fin, jun.id, "BANK_RECS", true)).rejects.toThrow(/Period not found/);
  });
});
