import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg } from "../helpers";
import { updateHrPolicy } from "@/server/services/hr-policy";
import {
  addNote,
  assessBreach,
  breachesNeedingAttention,
  closeBreach,
  getBreach,
  listBreaches,
  recordIndividualsNotified,
  recordRegulatorNotified,
  reportBreach,
  updateDetails,
} from "@/server/services/breaches";
import { buildHrDigest } from "@/server/services/reminders";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 16);

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const log = (over: Record<string, unknown> = {}) =>
    reportBreach(hr, { title: "Laptop lost", description: "An unencrypted laptop with payroll files was left in a taxi.", discoveredAt: hoursAgo(5), dataCategories: ["Bank account details"], individualsAffected: 40, ...over } as never);
  return { t, hr, log };
}

const contain = (hr: ReturnType<Awaited<ReturnType<typeof world>>["t"]["ctx"]>, id: string) =>
  updateDetails(hr, id, { containmentNote: "Remote wipe issued and the taxi firm contacted.", rootCause: "Device was unencrypted and left unattended.", remediation: "Full-disk encryption on every laptop." });

describe("logging a breach", () => {
  it("numbers it, starts the timeline, and starts the clock unassessed", async () => {
    const { t, hr, log } = await world();
    const b = await log();
    expect(b.incidentNumber).toBe("BRC-00001");
    expect((await log({ title: "Second one" })).incidentNumber).toBe("BRC-00002");
    const full = await getBreach(hr, b.id);
    expect(full?.assessment).toBe("UNASSESSED");
    expect(full?.state).toBe("RUNNING");
    expect(full?.updates.map((u) => u.note)).toEqual(["Breach logged."]);
    expect(full?.hoursLeft).toBeGreaterThanOrEqual(66);
    // tenancy: another organization can't see it
    const other = await isolatedOrg();
    expect(await getBreach(other.ctx("HR_ADMIN"), b.id)).toBeNull();
    expect((await listBreaches(other.ctx("HR_ADMIN"))).rows).toHaveLength(0);
    expect(t.org.id).not.toBe(other.org.id);
  });

  it("refuses a future discovery time, a happened-after-discovered date, and people without HR rights", async () => {
    const { t, log } = await world();
    await expect(log({ discoveredAt: new Date(Date.now() + 3_600_000).toISOString().slice(0, 16) })).rejects.toThrow(/future/i);
    await expect(log({ occurredOn: "2999-01-01" })).rejects.toThrow(/after it was discovered/i);
    await expect(reportBreach(t.ctx("EMPLOYEE"), { title: "x".repeat(8), description: "y".repeat(20), discoveredAt: hoursAgo(1) })).rejects.toThrow(/permission/i);
    await expect(reportBreach(t.ctx("AUDITOR"), { title: "x".repeat(8), description: "y".repeat(20), discoveredAt: hoursAgo(1) })).rejects.toThrow(/permission/i);
  });
});

describe("the regulator's deadline", () => {
  it("is counted from discovery using the policy's hours, and goes overdue even before anyone assesses it", async () => {
    const { t, hr, log } = await world();
    const fresh = await log();
    const old = await log({ title: "Old one", discoveredAt: hoursAgo(80) });
    expect((await getBreach(hr, fresh.id))?.state).toBe("RUNNING");
    expect((await getBreach(hr, old.id))?.state).toBe("OVERDUE");
    await updateHrPolicy(t.ctx("HR_ADMIN"), { breachNotifyHours: 96 });
    expect((await getBreach(hr, old.id))?.state).toBe("DUE_SOON"); // 16h left of 96
  });

  it("nothing is owed on a no-risk breach, and the register keeps it all the same", async () => {
    const { hr, log } = await world();
    const b = await log({ discoveredAt: hoursAgo(200) });
    await assessBreach(hr, b.id, "NO_RISK", "Internal recipient, deleted unread, confirmed in writing.");
    const full = await getBreach(hr, b.id);
    expect(full?.state).toBe("NOT_REQUIRED");
    expect((await listBreaches(hr)).rows).toHaveLength(1);
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) })).rejects.toThrow(/doesn't need to be told/i);
  });
});

describe("assessment", () => {
  it("needs a real explanation and the approval permission, and is on the timeline and audit trail", async () => {
    const { t, hr, log } = await world();
    const b = await log();
    await expect(assessBreach(hr, b.id, "RISK", "short")).rejects.toThrow(/explain/i);
    await expect(assessBreach(t.ctx("PAYROLL_ADMIN"), b.id, "RISK", "Bank details were on the device and it was unencrypted")).rejects.toThrow(/permission/i);
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    const full = await getBreach(hr, b.id);
    expect(full?.assessment).toBe("RISK");
    expect(full?.assessedBy).toBe(hr.name);
    expect(full?.updates.at(-1)?.note).toMatch(/Assessed as "risk"/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "BREACH_ASSESS", entityId: b.id } })).toBe(1);
  });

  it("can't be downgraded to no risk after the regulator has been told", async () => {
    const { hr, log } = await world();
    const b = await log();
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) });
    await expect(assessBreach(hr, b.id, "NO_RISK", "On reflection this was harmless, honestly")).rejects.toThrow(/already been told/i);
  });
});

describe("telling the regulator", () => {
  it("needs the breach assessed first, and refuses impossible times", async () => {
    const { hr, log } = await world();
    const b = await log({ discoveredAt: hoursAgo(10) });
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) })).rejects.toThrow(/assess/i);
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: new Date(Date.now() + 3_600_000).toISOString().slice(0, 16) })).rejects.toThrow(/future/i);
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(20) })).rejects.toThrow(/before the company knew/i);
  });

  it("records an on-time notification with its reference", async () => {
    const { hr, log } = await world();
    const b = await log({ discoveredAt: hoursAgo(30) });
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(2), reference: "NDPC-2026-0042" });
    const full = await getBreach(hr, b.id);
    expect(full?.state).toBe("ON_TIME");
    expect(full?.ndpcReference).toBe("NDPC-2026-0042");
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) })).rejects.toThrow(/already been told/i);
  });

  it("demands the reason for the delay when it is after the deadline, and keeps it", async () => {
    const { hr, log } = await world();
    const b = await log({ discoveredAt: hoursAgo(100) });
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await expect(recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) })).rejects.toThrow(/reason for the delay/i);
    await recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1), lateReason: "We only learned the laptop held payroll data on day four." });
    const full = await getBreach(hr, b.id);
    expect(full?.state).toBe("LATE");
    expect(full?.lateReason).toMatch(/day four/);
  });
});

describe("telling the people affected", () => {
  it("is only for high-risk breaches", async () => {
    const { hr, log } = await world();
    const b = await log();
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await expect(recordIndividualsNotified(hr, b.id, { notifiedAt: hoursAgo(1), note: "Sent an SMS to everyone" })).rejects.toThrow(/high risk/i);
    await assessBreach(hr, b.id, "HIGH_RISK", "Account numbers with names and salaries; fraud is likely");
    await expect(recordIndividualsNotified(hr, b.id, { notifiedAt: hoursAgo(1), note: "short" })).rejects.toThrow(/how they were told/i);
    await recordIndividualsNotified(hr, b.id, { notifiedAt: hoursAgo(1), note: "Sent an SMS and a letter to every affected employee" });
    expect((await getBreach(hr, b.id))?.individualsNotifiedAt).not.toBeNull();
  });
});

describe("closing", () => {
  it("lists everything still missing", async () => {
    const { hr, log } = await world();
    const b = await log();
    await expect(closeBreach(hr, b.id)).rejects.toThrow(/assess the risk.*contained.*cause.*recurring/is);
    await assessBreach(hr, b.id, "HIGH_RISK", "Account numbers with names and salaries; fraud is likely");
    await contain(hr, b.id);
    await expect(closeBreach(hr, b.id)).rejects.toThrow(/regulator was told.*people affected were told/is);
    await recordRegulatorNotified(hr, b.id, { notifiedAt: hoursAgo(1) });
    await expect(closeBreach(hr, b.id)).rejects.toThrow(/people affected were told/i);
    await recordIndividualsNotified(hr, b.id, { notifiedAt: hoursAgo(1), note: "Sent an SMS and a letter to every affected employee" });
    await closeBreach(hr, b.id, "All actions complete.");
    const full = await getBreach(hr, b.id);
    expect(full?.status).toBe("CLOSED");
    expect(full?.closedBy).toBe(hr.name);
  });

  it("closes a no-risk breach without any notification, then locks it", async () => {
    const { hr, log } = await world();
    const b = await log();
    await assessBreach(hr, b.id, "NO_RISK", "Internal recipient, deleted unread, confirmed in writing.");
    await contain(hr, b.id);
    await closeBreach(hr, b.id);
    await expect(addNote(hr, b.id, "A late thought about this")).rejects.toThrow(/closed/i);
    await expect(updateDetails(hr, b.id, { rootCause: "Changed my mind about the cause" })).rejects.toThrow(/closed/i);
    await expect(assessBreach(hr, b.id, "RISK", "Reopening by the back door, which is not allowed")).rejects.toThrow(/closed/i);
    await expect(closeBreach(hr, b.id)).rejects.toThrow(/closed/i);
  });

  it("only someone with approval rights can close it", async () => {
    const { t, hr, log } = await world();
    const b = await log();
    await assessBreach(hr, b.id, "NO_RISK", "Internal recipient, deleted unread, confirmed in writing.");
    await contain(hr, b.id);
    await expect(closeBreach(t.ctx("OPERATIONS"), b.id)).rejects.toThrow(/permission/i);
  });
});

describe("timeline", () => {
  it("keeps every step in order with who did it", async () => {
    const { hr, log } = await world();
    const b = await log();
    await addNote(hr, b.id, "Spoke to the taxi firm; no sign of the laptop.");
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    const notes = (await getBreach(hr, b.id))?.updates.map((u) => u.note) ?? [];
    expect(notes[0]).toBe("Breach logged.");
    expect(notes[1]).toMatch(/taxi firm/);
    expect(notes[2]).toMatch(/Assessed/);
  });
});

describe("the notice summary and the HR digest", () => {
  it("gathers the facts for the regulator from the record", async () => {
    const { hr, log } = await world();
    const b = await log();
    await assessBreach(hr, b.id, "RISK", "Bank details were on the device and it was unencrypted");
    await contain(hr, b.id);
    const s = (await getBreach(hr, b.id))?.summary ?? "";
    expect(s).toContain(b.incidentNumber);
    expect(s).toContain("Bank account details");
    expect(s).toContain("40");
    expect(s).toContain("Remote wipe issued");
    expect(s).toContain(hr.email);
  });

  it("flags unassessed and overdue breaches for HR, and stops once they are dealt with", async () => {
    const { t, hr, log } = await world();
    await db.hrPolicy.upsert({ where: { organizationId: t.org.id }, update: {}, create: { organizationId: t.org.id } });
    const fresh = await log({ title: "Fresh and unassessed" });
    const stale = await log({ title: "Stale and assessed", discoveredAt: hoursAgo(90) });
    await assessBreach(hr, stale.id, "RISK", "Bank details were on the device and it was unencrypted");
    const need = await breachesNeedingAttention(t.org.id, new Date());
    expect(need.map((b) => b.id).sort()).toEqual([fresh.id, stale.id].sort());
    const digest = await buildHrDigest(t.org.id);
    expect(digest.sections.find((s) => s.key === "breaches")?.count).toBe(2);
    await recordRegulatorNotified(hr, stale.id, { notifiedAt: hoursAgo(1), lateReason: "Only learned what was on the device later." });
    await assessBreach(hr, fresh.id, "NO_RISK", "Internal recipient, deleted unread, confirmed in writing.");
    expect(await breachesNeedingAttention(t.org.id, new Date())).toHaveLength(0);
  });
});
