import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import JSZip from "jszip";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { createEmployee } from "@/server/services/employees";
import { deliveryOverview, emailPayslips, payslipPdf, payslipsZip, setPayslipEmail } from "@/server/services/payslips";
import { isolatedOrg } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const isPdf = (b: Buffer | Uint8Array) => Buffer.from(b.slice(0, 5)).toString() === "%PDF-";

/** An approved/locked October payroll of three people: two with an email address, one without. */
async function world(status: "LOCKED" | "CALCULATED" = "LOCKED") {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status } });
  const people = [
    { first: "Ada", last: "Obi", email: "ada@example.test" },
    { first: "Bayo", last: "Ade", email: "bayo@example.test" },
    { first: "Chi", last: "Eze", email: undefined },
  ];
  const emps = [];
  const recs = [];
  for (const p of people) {
    const e = await createEmployee(hr, { firstName: p.first, lastName: p.last, email: p.email, employmentDate: "2025-01-01", categoryId: t.guardId });
    emps.push(e);
    recs.push(
      await db.payrollRecord.create({
        data: {
          organizationId: t.org.id, runId: run.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: `${p.first} ${p.last}`, categoryName: "Security Guard",
          bankName: "GTBank", accountNumber: "0123456789", accountName: `${p.first} ${p.last}`.toUpperCase(), pensionPin: "PEN100200300400", taxId: "TIN1",
          basisDays: 31, daysWorked: 31, monthlyGross: 200000, earnedGross: 200000, totalEarnings: 200000, pensionBase: 0, employeePension: 16000, employerPension: 20000,
          taxableIncome: 184000, paye: 15500, totalDeductions: 31500, netPay: 168500, employerCost: 220000, taxRuleVersion: "NG-PAYE@1",
          lines: [
            { type: "EARNING", code: "BASIC", name: "Basic", amount: 120000 }, { type: "EARNING", code: "HOUSING", name: "Housing", amount: 80000 },
            { type: "DEDUCTION", code: "PAYE", name: "PAYE", amount: 15500 }, { type: "DEDUCTION", code: "PEN", name: "Employee pension", amount: 16000 },
            { type: "EMPLOYER", code: "ERP", name: "Employer pension", amount: 20000 },
          ],
          locations: [],
        },
      }),
    );
  }
  return { t, hr, fin: t.ctx("FINANCE", null, 1), admin: t.ctx("COMPANY_ADMIN", null, 1), run, emps, recs };
}

beforeEach(() => mail.mockClear());

describe("downloading payslips", () => {
  it("gives a PDF for one payslip, records the download, and keeps others out", async () => {
    const w = await world();
    const f = await payslipPdf(w.fin, w.recs[0].id);
    expect(isPdf(f.bytes)).toBe(true);
    expect(f.fileName).toBe(`payslip-${w.recs[0].employeeNumber}-October-2026.pdf`);
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "PAYSLIP_PDF_DOWNLOAD" } });
    expect(log).toMatchObject({ userName: w.fin.name, entityId: w.recs[0].id });
    await expect(payslipPdf(w.t.ctx("AUDITOR", null, 1), w.recs[0].id)).rejects.toThrow(/permission/);
    await expect(payslipPdf(w.t.ctx("SUPERVISOR", null, 1), w.recs[0].id)).rejects.toThrow(/Payslip not found/);
    const other = await isolatedOrg();
    await expect(payslipPdf(other.ctx("FINANCE", null, 1), w.recs[0].id)).rejects.toThrow(/Payslip not found/);
  });

  it("lets an employee fetch only their own payslip, and only once the payroll is approved", async () => {
    const w = await world();
    const me = { ...w.t.ctx("EMPLOYEE", w.emps[0].id, 1), employeeId: w.emps[0].id };
    expect(isPdf((await payslipPdf(me, w.recs[0].id)).bytes)).toBe(true);
    await expect(payslipPdf(me, w.recs[1].id)).rejects.toThrow(/Payslip not found/);
    await db.payrollRun.update({ where: { id: w.run.id }, data: { status: "CALCULATED" } });
    await expect(payslipPdf(me, w.recs[0].id)).rejects.toThrow(/Payslip not found/);
  });

  it("zips a whole payroll's payslips, named by employee and month, only once it is approved", async () => {
    const w = await world();
    const z = await payslipsZip(w.fin, w.run.id);
    expect(z.count).toBe(3);
    expect(z.fileName).toBe("payslips-October-2026.zip");
    const zip = await JSZip.loadAsync(z.buffer);
    expect(Object.keys(zip.files).sort()).toEqual(w.recs.map((r) => `payslip-${r.employeeNumber}-October-2026.pdf`).sort());
    for (const f of Object.values(zip.files)) expect(isPdf(await f.async("nodebuffer"))).toBe(true);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PAYSLIPS_ZIP_DOWNLOAD" } })).toBe(1);
    await expect(payslipsZip(w.t.ctx("AUDITOR", null, 1), w.run.id)).rejects.toThrow(/permission/);
    const open = await world("CALCULATED");
    await expect(payslipsZip(open.fin, open.run.id)).rejects.toThrow(/once the payroll is approved/);
  });
});

describe("emailing payslips", () => {
  it("is off until switched on by someone who manages settings", async () => {
    const w = await world();
    await expect(emailPayslips(w.fin, w.run.id)).rejects.toThrow(/switched off/);
    await expect(setPayslipEmail(w.fin, true)).rejects.toThrow(/permission/);
    await setPayslipEmail(w.admin, true);
    expect(mail).not.toHaveBeenCalled();
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PAYSLIP_EMAIL_SETTING" } })).toBe(1);
  });

  it("sends each employee their own PDF, skips those with no address, and never sends twice unless asked", async () => {
    const w = await world();
    await setPayslipEmail(w.admin, true);
    const out = await emailPayslips(w.fin, w.run.id);
    expect(out.map((o) => o.status)).toEqual(["SENT", "SENT", "NO_EMAIL"]);
    expect(mail).toHaveBeenCalledTimes(2);
    const first = mail.mock.calls[0][0];
    expect(first.to).toBe("ada@example.test");
    expect(first.subject).toBe("Your payslip for October 2026");
    expect(first.text).toMatch(/Dear Ada,/);
    expect(first.attachments).toHaveLength(1);
    expect(first.attachments![0].filename).toBe(`payslip-${w.recs[0].employeeNumber}-October-2026.pdf`);
    expect(isPdf(first.attachments![0].content)).toBe(true);
    expect(first.text).not.toMatch(/168,500|0123456789/); // the figures are in the attachment, not in the message

    const log = await db.payslipDelivery.findMany({ where: { runId: w.run.id }, orderBy: { sentAt: "asc" } });
    expect(log.map((l) => l.toEmail)).toEqual(["ada@example.test", "bayo@example.test"]);
    expect(log[0]).toMatchObject({ sentBy: w.fin.name, recordId: w.recs[0].id });
    expect(log[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    const o = await deliveryOverview(w.fin, w.run.id);
    expect(o).toMatchObject({ withEmail: 2, withoutEmail: 1, alreadySent: 2 });

    mail.mockClear();
    expect((await emailPayslips(w.fin, w.run.id)).map((x) => x.status)).toEqual(["ALREADY_SENT", "ALREADY_SENT", "NO_EMAIL"]);
    expect(mail).not.toHaveBeenCalled();
    // a resend is for named people only
    await expect(emailPayslips(w.fin, w.run.id, { resend: true })).rejects.toThrow(/named employees/);
    const again = await emailPayslips(w.fin, w.run.id, { recordIds: [w.recs[0].id], resend: true });
    expect(again.map((x) => x.status)).toEqual(["SENT"]);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(await db.payslipDelivery.count({ where: { runId: w.run.id } })).toBe(3);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PAYSLIPS_EMAILED" } })).toBe(3);
  });

  it("tries again after a failed send, because a failure is not recorded", async () => {
    const w = await world();
    await setPayslipEmail(w.admin, true);
    mail.mockRejectedValueOnce(new Error("mailbox full"));
    const out = await emailPayslips(w.fin, w.run.id);
    expect(out.map((o) => o.status)).toEqual(["FAILED", "SENT", "NO_EMAIL"]);
    expect(await db.payslipDelivery.count({ where: { runId: w.run.id } })).toBe(1);
    mail.mockClear();
    const retry = await emailPayslips(w.fin, w.run.id);
    expect(retry.map((o) => o.status)).toEqual(["SENT", "ALREADY_SENT", "NO_EMAIL"]);
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it("only goes out for an approved payroll and to people who may distribute payslips, and its record cannot be altered", async () => {
    const open = await world("CALCULATED");
    await setPayslipEmail(open.admin, true);
    await expect(emailPayslips(open.fin, open.run.id)).rejects.toThrow(/once the payroll is approved/);
    const w = await world();
    await setPayslipEmail(w.admin, true);
    await expect(emailPayslips(w.t.ctx("AUDITOR", null, 1), w.run.id)).rejects.toThrow(/permission/);
    await emailPayslips(w.fin, w.run.id);
    const rec = await db.payslipDelivery.findFirstOrThrow({ where: { runId: w.run.id } });
    await expect(db.payslipDelivery.update({ where: { id: rec.id }, data: { toEmail: "x@y.z" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.payslipDelivery.delete({ where: { id: rec.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });
});
