import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { confirmBlockedEntry, createPayingBank, listCodeSetEntries } from "@/server/services/paying-banks";
import { isolatedOrg } from "../helpers";

/** The entry as it stands in the bank's newest list. */
async function entry(ctx: Parameters<typeof listCodeSetEntries>[0], bankId: string, name: string, code?: string) {
  const { entries, set } = await listCodeSetEntries(ctx, bankId);
  const e = entries.find((x) => x.name === name && (code === undefined || x.code === code));
  if (!e) throw new Error(`no ${name}`);
  return { e, set: set! };
}

describe("confirming a blocked bank code once the bank has said what it is", () => {
  it("applies the confirmed code as a new version, unblocks only that entry, and leaves the old version as it was", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const bank = await createPayingBank(fin, { name: "First Bank", builtIn: "FIRST_BANK" });
    const before = await entry(fin, bank.id, "BOLDMFB");
    expect(before.e).toMatchObject({ code: "95", blocked: true });

    const v2 = await confirmBlockedEntry(fin, bank.id, before.e.id, { code: "095", note: "Confirmed by First Bank relationship manager, email of 29 Oct 2026" });
    expect(v2.version).toBe(before.set.version + 1);
    expect(v2.blockedCount).toBe(before.set.blockedCount - 1);
    const after = await entry(fin, bank.id, "BOLDMFB");
    expect(after.e).toMatchObject({ code: "095", blocked: false, blockedReason: null });
    // everything else is carried over untouched, and the earlier version still shows what the bank first listed
    expect((await listCodeSetEntries(fin, bank.id, before.set.version)).entries.find((x) => x.name === "BOLDMFB")).toMatchObject({ code: "95", blocked: true });
    expect(v2.entryCount).toBe(before.set.entryCount);
    expect((await entry(fin, bank.id, "COOPFUND MFB")).e).toMatchObject({ code: "62", blocked: true });

    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, action: "BANK_CODE_CONFIRM" } });
    expect(audit.reason).toMatch(/relationship manager/);
  });

  it("when two banks share a code, confirming one leaves the other blocked", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const bank = await createPayingBank(fin, { name: "Access Bank", builtIn: "ACCESS_BANK" });
    const corestep = await entry(fin, bank.id, "CORESTEP MICROFINANCE BANK", "A43");
    expect(corestep.e.blocked).toBe(true);
    await confirmBlockedEntry(fin, bank.id, corestep.e.id, { code: "A43", note: "Access Bank confirmed A43 is Corestep" });
    expect((await entry(fin, bank.id, "CORESTEP MICROFINANCE BANK", "A43")).e.blocked).toBe(false);
    expect((await entry(fin, bank.id, "BLOOMS MFB", "A43")).e.blocked).toBe(true);
  });

  it("needs a real code and a note saying who confirmed it, refuses entries that are not blocked, and respects permissions and organizations", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const bank = await createPayingBank(fin, { name: "First Bank", builtIn: "FIRST_BANK" });
    const blocked = (await entry(fin, bank.id, "BOLDMFB")).e;
    await expect(confirmBlockedEntry(fin, bank.id, blocked.id, { code: "09", note: "Confirmed by the bank in writing" })).rejects.toThrow(/3 to 6 letters or digits/);
    await expect(confirmBlockedEntry(fin, bank.id, blocked.id, { code: "095", note: "ok" })).rejects.toThrow(/who confirmed/i);
    const fine = (await entry(fin, bank.id, "GUARANTY TRUST BANK")).e;
    await expect(confirmBlockedEntry(fin, bank.id, fine.id, { code: "058", note: "Confirmed by the bank in writing" })).rejects.toThrow(/not blocked/);
    await expect(confirmBlockedEntry(t.ctx("AUDITOR", null, 1), bank.id, blocked.id, { code: "095", note: "Confirmed by the bank in writing" })).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    await expect(confirmBlockedEntry(other.ctx("FINANCE", null, 1), bank.id, blocked.id, { code: "095", note: "Confirmed by the bank in writing" })).rejects.toThrow(/not found/);
    // an entry of an OLDER version cannot be confirmed: only the newest list is
    await confirmBlockedEntry(fin, bank.id, blocked.id, { code: "095", note: "Confirmed by the bank in writing" });
    await expect(confirmBlockedEntry(fin, bank.id, blocked.id, { code: "095", note: "Confirmed by the bank in writing" })).rejects.toThrow(/newest list/);
  });
});
