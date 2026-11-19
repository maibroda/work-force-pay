import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { exportPaymentFile } from "@/server/services/payment-file";
import { generateRemittances, markBatchPaid, markRemitted } from "@/server/services/payments";
import { isolatedOrg } from "../helpers";

// Demo company safeguards (the founder's decision 9 of 2026-11-14, design approved on 2026-11-19; docs/plans/host-configuration-and-demo-data.md, section 3). A fictional company made by the seed is marked
// Organization.isDemo, and a demo company can never produce a bank payment file, mark a payment batch paid, generate a statutory remittance or mark one remitted, so a demo number can never be paid or
// filed. The founder chose to BLOCK these outright (not to stamp a file as demo). The checks run before anything is read, so the ids below do not need to exist. Everything here is invented.

const DEMO = /demo company/i;

async function company(demo: boolean) {
  const t = await isolatedOrg();
  if (demo) await db.organization.update({ where: { id: t.org.id }, data: { isDemo: true } });
  return t;
}

describe("which companies are demo companies", () => {
  it("every company the seed made is a demo company, and a company made any other way is not", async () => {
    // the demo company itself (DSS) is left out on purpose: a few other tests switch it to an ordinary company for their own purposes (tests/helpers.ts), so its flag is not stable during a run
    const seeded = await db.organization.findMany({ where: { OR: [{ code: { in: ["NGL", "THREEROOTS", "ACMEFAC"] } }] }, select: { code: true, isDemo: true } });
    expect(seeded.length).toBeGreaterThanOrEqual(3); // the second fictional company, the bureau and its demo client
    expect(seeded.filter((o) => !o.isDemo)).toEqual([]);
    const t = await company(false);
    expect((await db.organization.findUniqueOrThrow({ where: { id: t.org.id } })).isDemo).toBe(false);
  });
});

describe("what a demo company cannot do", () => {
  it("cannot make a bank payment file", async () => {
    const t = await company(true);
    await expect(exportPaymentFile(t.ctx("FINANCE"), "no-such-run")).rejects.toThrow(DEMO);
  });

  it("cannot mark a payment batch paid", async () => {
    const t = await company(true);
    await expect(markBatchPaid(t.ctx("FINANCE"), "no-such-batch")).rejects.toThrow(DEMO);
  });

  it("cannot generate a statutory remittance", async () => {
    const t = await company(true);
    await expect(generateRemittances(t.ctx("FINANCE"), "no-such-run")).rejects.toThrow(DEMO);
  });

  it("cannot mark a statutory remittance remitted", async () => {
    const t = await company(true);
    await expect(markRemitted(t.ctx("FINANCE"), "no-such-remittance", "REF-1")).rejects.toThrow(DEMO);
  });

  it("is told plainly why, in words a payroll officer can use", async () => {
    const t = await company(true);
    await expect(exportPaymentFile(t.ctx("FINANCE"), "no-such-run")).rejects.toThrow(/a bank payment file is not available.*can never be paid or filed/i);
  });
});

describe("a company that is not a demo company is not affected", () => {
  it("gets the ordinary answer, not the demo message", async () => {
    const t = await company(false);
    const fin = t.ctx("FINANCE");
    for (const call of [() => exportPaymentFile(fin, "no-such-run"), () => markBatchPaid(fin, "no-such-batch"), () => generateRemittances(fin, "no-such-run"), () => markRemitted(fin, "no-such-remittance", "REF-1")]) {
      const err = await call().then(() => null, (e: Error) => e);
      expect(err).toBeTruthy();
      expect(err!.message).not.toMatch(DEMO);
      expect(err!.message).toMatch(/not found/i);
    }
  });

  it("is judged by its own flag only: another company being a demo company changes nothing", async () => {
    const real = await company(false);
    await company(true);
    const err = await exportPaymentFile(real.ctx("FINANCE"), "no-such-run").then(() => null, (e: Error) => e);
    expect(err!.message).not.toMatch(DEMO);
  });
});

describe("the order of the checks", () => {
  it("a role without the right is told so before anything about demo", async () => {
    const t = await company(true);
    await expect(exportPaymentFile(t.ctx("AUDITOR"), "no-such-run")).rejects.toThrow(/permission/);
    await expect(markRemitted(t.ctx("AUDITOR"), "no-such-remittance", "REF-1")).rejects.toThrow(/permission/);
  });
});
