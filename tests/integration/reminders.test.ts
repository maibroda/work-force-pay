import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { sendEmail } from "@/lib/email";
import { createEmployee } from "@/server/services/employees";
import { createContract } from "@/server/services/contracts";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { createItem, issueKit } from "@/server/services/inventory";
import { createRequisition } from "@/server/services/recruitment";
import { raiseCase } from "@/server/services/relations";
import { buildHrDigest, renderDigest, sendHrDigest, sendHrDigestNow, previewHrDigest } from "@/server/services/reminders";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
beforeEach(() => mail.mockClear());

/** A throwaway org with two HR admins and something in most digest sections. */
async function busyOrg() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  for (const n of ["one", "two"])
    await db.user.create({ data: { organizationId: t.org.id, email: `hr-${n}-${uid()}@digest.test`.toLowerCase(), name: `HR ${n}`, role: "HR_ADMIN", passwordHash: "x" } });
  const today = todayUtc();

  const ending = await createEmployee(hr, { firstName: "Ending", lastName: "Soon", employmentDate: "2025-01-01", categoryId: t.guardId });
  await createContract(hr, { employeeId: ending.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: iso(addDays(today, -200)), endDate: iso(addDays(today, 20)) });
  const probation = await createEmployee(hr, { firstName: "Probation", lastName: "Overdue", employmentDate: "2025-01-01", categoryId: t.guardId });
  await createContract(hr, { employeeId: probation.id, type: "PROBATION", jobTitle: "Guard", startDate: iso(addDays(today, -120)), probationMonths: 3 });
  await createEmployee(hr, { firstName: "Nocontract", lastName: "Onfile", employmentDate: "2025-01-01", categoryId: t.guardId }); // no contract recorded
  await createRequisition(hr, { title: "Cleaner", categoryId: t.officeId, justification: "Cover for leave", headcount: 1, employmentType: "PERMANENT" });
  const c = await raiseCase(hr, { employeeId: ending.id, type: "MISCONDUCT", summary: "Late to post", description: "Repeatedly late on night shifts." });
  await db.relationsCase.update({ where: { id: c.id }, data: { dueDate: addDays(today, -2) } });
  return { t, hr, ending, probation };
}

describe("buildHrDigest", () => {
  it("lists what needs attention, section by section, and leaves out the empty ones", async () => {
    const { t } = await busyOrg();
    const d = await buildHrDigest(t.org.id);
    const keys = d.sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["approvals", "contracts", "probation", "onboarding", "relations", "no-contract"]));
    expect(keys).not.toContain("kit");
    expect(keys).not.toContain("loans");
    expect(d.sections.find((s) => s.key === "approvals")!.items[0].text).toMatch(/REQ-\d+ — Cleaner/);
    expect(d.sections.find((s) => s.key === "contracts")!.items[0].text).toMatch(/ends/);
    expect(d.sections.find((s) => s.key === "probation")!.items[0].text).toMatch(/overdue/);
    expect(d.sections.find((s) => s.key === "relations")!.items[0].text).toMatch(/past its target/);
    expect(d.total).toBe(d.sections.reduce((s, x) => s + x.count, 0));
  });

  it("hides the content of a confidential case, and picks up leavers still holding kit", async () => {
    const { t, hr, ending } = await busyOrg();
    await raiseCase(hr, { employeeId: ending.id, type: "WHISTLEBLOWING", summary: "Secret fraud allegation", description: "A detailed confidential description." });
    await db.relationsCase.updateMany({ where: { organizationId: t.org.id, type: "WHISTLEBLOWING" }, data: { dueDate: addDays(todayUtc(), -1) } });
    const ops = t.ctx("OPERATIONS");
    const shirt = await createItem(ops, { name: "Shirt", category: "UNIFORM", size: "L", unit: "pcs", reorderLevel: 0, openingQuantity: 5, openingUnitCost: 1000 });
    const leaver = await createEmployee(hr, { firstName: "Left", lastName: "Holding", employmentDate: "2025-01-01", categoryId: t.guardId });
    await issueKit(ops, { employeeId: leaver.id, itemId: shirt.id, quantity: 2 });
    await db.employee.update({ where: { id: leaver.id }, data: { status: "RESIGNED" } });

    const d = await buildHrDigest(t.org.id);
    const texts = d.sections.find((s) => s.key === "relations")!.items.map((i) => i.text).join(" | ");
    expect(texts).toMatch(/Confidential case/);
    expect(texts).not.toMatch(/Secret fraud/);
    expect(d.sections.find((s) => s.key === "kit")!.items[0].text).toMatch(/2 item\(s\), ₦2,000/);
  });

  it("is empty for an organization with nothing to do", async () => {
    const t = await isolatedOrg();
    const d = await buildHrDigest(t.org.id);
    expect(d.total).toBe(0);
    expect(d.sections).toEqual([]);
  });
});

describe("renderDigest", () => {
  it("makes a subject with the count, and links every item to the app", async () => {
    const { t } = await busyOrg();
    const d = await buildHrDigest(t.org.id);
    const m = renderDigest(d, "https://hr.example.com/");
    expect(m.subject).toContain(`${d.total} item(s) need attention`);
    expect(m.text).toContain("https://hr.example.com/hr/requisitions/");
    expect(m.text).toContain("https://hr.example.com/hr");
    expect(m.html).toContain('href="https://hr.example.com/hr/contracts/');
    expect(m.html).not.toContain("<script");
  });
});

describe("sendHrDigest", () => {
  it("emails every active HR admin and the extra addresses once, then not again the same day", async () => {
    const { t } = await busyOrg();
    await updateHrPolicy(t.ctx("HR_ADMIN"), { reminderExtraEmails: [`Boss-${uid()}@digest.test`] });
    const first = await sendHrDigest(t.org.id);
    expect(first.skipped).toBeUndefined();
    expect(first.sent).toBe(3); // two HR admins + the extra address
    expect(mail).toHaveBeenCalledTimes(3);
    expect(mail.mock.calls.every(([m]) => m.subject.includes("HR digest") && m.to === m.to.toLowerCase())).toBe(true);
    expect((await getHrPolicy(t.org.id)).lastDigestAt).toBeTruthy();

    mail.mockClear();
    const second = await sendHrDigest(t.org.id);
    expect(second.skipped).toMatch(/already sent today/);
    expect(mail).not.toHaveBeenCalled();
    const forced = await sendHrDigest(t.org.id, { force: true });
    expect(forced.sent).toBe(3);

    const next = await sendHrDigest(t.org.id, { now: new Date(Date.now() + 36 * 3600 * 1000) }); // a day or so later
    expect(next.skipped).toBeUndefined();
    const audit = await db.auditLog.findFirst({ where: { organizationId: t.org.id, action: "HR_DIGEST_SENT" } });
    expect(audit?.userName).toBe("System (HR digest)");
  });

  it("sends nothing when there is nothing to report, when switched off, or with nobody to send to", async () => {
    const quiet = await isolatedOrg();
    await db.user.create({ data: { organizationId: quiet.org.id, email: `hr-${uid()}@digest.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    expect((await sendHrDigest(quiet.org.id)).skipped).toMatch(/Nothing needs attention/);

    const { t } = await busyOrg();
    await updateHrPolicy(t.ctx("HR_ADMIN"), { reminderEmailsEnabled: false });
    expect((await sendHrDigest(t.org.id)).skipped).toMatch(/switched off/);

    const lonely = await isolatedOrg();
    await createRequisition(lonely.ctx("HR_ADMIN"), { title: "Driver", categoryId: lonely.guardId, justification: "Replace a leaver", headcount: 1, employmentType: "PERMANENT" });
    expect((await sendHrDigest(lonely.org.id)).skipped).toMatch(/nobody to send it to/);
    expect(mail).not.toHaveBeenCalled();
  });

  it("keeps going when one address fails, and reports it", async () => {
    const { t } = await busyOrg();
    const bad = `bad-${uid()}@digest.test`.toLowerCase();
    await updateHrPolicy(t.ctx("HR_ADMIN"), { reminderExtraEmails: [bad] });
    mail.mockImplementation(async (m) => {
      if (m.to === bad) throw new Error("mailbox full");
    });
    const r = await sendHrDigest(t.org.id);
    mail.mockImplementation(async () => undefined);
    expect(r.sent).toBe(2);
    expect(r.failed).toEqual([bad]);
    expect((await getHrPolicy(t.org.id)).lastDigestAt).toBeTruthy(); // at least one went, so today is done
  });

  it("validates the extra addresses", async () => {
    const t = await isolatedOrg();
    await expect(updateHrPolicy(t.ctx("HR_ADMIN"), { reminderExtraEmails: ["not-an-email"] })).rejects.toThrow();
  });
});

describe("sending and previewing from the app", () => {
  it("lets HR send one on demand (ignoring the once-a-day rule) and preview it, but not other roles", async () => {
    const { t, hr } = await busyOrg();
    await sendHrDigest(t.org.id);
    mail.mockClear();
    const r = await sendHrDigestNow(hr);
    expect(r.sent).toBe(2);
    await expect(sendHrDigestNow(t.ctx("AUDITOR"))).rejects.toThrow();
    const p = await previewHrDigest(t.ctx("AUDITOR")); // read-only viewers may see it
    expect(p.digest.total).toBeGreaterThan(0);
    expect(p.recipientCount).toBe(2);
    expect(p.enabled).toBe(true);
    await expect(previewHrDigest(t.ctx("EMPLOYEE"))).rejects.toThrow();
  });
});
