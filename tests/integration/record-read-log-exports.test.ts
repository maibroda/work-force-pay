import { describe, expect, it, vi, type Mock } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { createEmployee, getEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { exportForRequest, exportMyData, openRequest, verifyIdentity } from "@/server/services/data-requests";
import { raiseDisciplinary } from "@/server/services/hr";
import { approveDisciplinary, listSanctions } from "@/server/services/hr";
import { employeeTimeline } from "@/server/services/hr-overview";
import { SENSITIVE_VIEW, sensitiveAccessLog } from "@/server/services/sensitive-access";
import { isolatedOrg, uid } from "../helpers";

// Governance step 6 (the last describe): the sanctions shown in an employee's HR history are recorded by the sanction's own id. Governance step 5: two reads the audit log did not record. (1) The sanctions register (the Disciplinary page's list of sanctions with the people they are about) and (2) a data export for
// a data access request (a person's whole file). Same rule as step 2a: logged BY THE RECORD (the register as a list with a count; the export by its request id, shown as the request number),
// never the employee and never the content; looking at your own is not recorded; and not recording is not an option: if the entry cannot be written, the read fails.

vi.mock("@/server/services/audit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/audit")>();
  return { ...mod, logAudit: vi.fn(mod.logAudit) };
});
import { logAudit } from "@/server/services/audit";

const SECRET = "SECRET-SANCTION-TEXT the guard left his post";

async function realUser(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], extra: Record<string, unknown> = {}) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}${uid()}@s5.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", ...extra } });
}
const ctxOf = (u: { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null }): Ctx => ({ userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId });

async function world() {
  const t = await isolatedOrg();
  const hr = ctxOf(await realUser(t, "HR_ADMIN"));
  const boss = ctxOf(await realUser(t, "COMPANY_ADMIN"));
  const auditor = ctxOf(await realUser(t, "AUDITOR"));
  const emp = await createEmployee(hr, { firstName: "Zainab", lastName: "Hiddenname", employmentDate: "2023-01-05", categoryId: t.guardId });
  const sanction = () => raiseDisciplinary(hr, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: iso(todayUtc()), description: SECRET } as never);
  const entries = () => db.auditLog.findMany({ where: { organizationId: t.org.id, action: SENSITIVE_VIEW }, orderBy: { createdAt: "asc" } });
  const openVerified = async (employeeId = emp.id) => {
    const r = await openRequest(hr, { employeeId, requesterName: "Zainab Hiddenname", receivedOn: iso(todayUtc()) });
    await verifyIdentity(hr, r.id, "Shown the staff ID card in person");
    return r;
  };
  return { t, hr, boss, auditor, emp, sanction, entries, openVerified };
}

describe("the sanctions register", () => {
  it("opening it writes one entry: who, the kind and how many sanctions were shown; never who they are about or what they say", async () => {
    const w = await world();
    await w.sanction();
    await w.sanction();
    const shown = await listSanctions(w.hr, { status: "PENDING" });
    expect(shown).toHaveLength(2);
    const rows = await w.entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: w.hr.userId, entity: "SensitiveList", entityId: "sanction-list" });
    expect(rows[0].newValue).toMatchObject({ kind: "SANCTION", count: 2 });
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`Zainab|Hiddenname|SECRET|left his post|${w.emp.id}`));
  });
  it("opening it again within ten minutes is one entry", async () => {
    const w = await world();
    await w.sanction();
    await listSanctions(w.hr, { status: "PENDING" });
    await listSanctions(w.hr, { status: "PENDING" });
    expect(await w.entries()).toHaveLength(1);
  });
  it("an empty register shows nothing, so records nothing", async () => {
    const w = await world();
    expect(await listSanctions(w.hr, { status: "PENDING" })).toHaveLength(0);
    expect(await w.entries()).toHaveLength(0);
  });
  it("is recorded for the auditor too, who may read it; a reader without the right is refused and nothing is recorded", async () => {
    const w = await world();
    await w.sanction();
    await listSanctions(w.auditor, {});
    const rows = await w.entries();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(w.auditor.userId);
    const stranger = ctxOf(await realUser(w.t, "SUPERVISOR"));
    await expect(listSanctions(stranger, {})).rejects.toThrow(/permission/i);
    expect(await w.entries()).toHaveLength(1);
  });
  it("if the entry cannot be written, the read fails and shows nothing", async () => {
    const w = await world();
    await w.sanction();
    (logAudit as Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(listSanctions(w.hr, { status: "PENDING" })).rejects.toThrow(/disk full/);
    expect(await w.entries()).toHaveLength(0);
  });
});

describe("a data export for a data access request", () => {
  it("writes one entry by the request: who, the kind and the request's own id; never the employee, the name or any of the file", async () => {
    const w = await world();
    await w.sanction();
    const r = await w.openVerified();
    await exportForRequest(w.hr, r.id);
    const rows = (await w.entries()).filter((x) => (x.newValue as { kind: string }).kind === "DATA_EXPORT");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: w.hr.userId, entity: "DataAccessRequest", entityId: r.id });
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`Zainab|Hiddenname|SECRET|${w.emp.id}`));
  });
  it("is written before the file is handed over, and the export's own audit entry and the request's record are unchanged", async () => {
    const w = await world();
    const r = await w.openVerified();
    const out = await exportForRequest(w.hr, r.id);
    expect(out.requestNumber).toBe(r.requestNumber);
    const after = await db.dataAccessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.exportedAt).not.toBeNull();
    const dsar = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "DSAR_EXPORT" } });
    expect(dsar).toHaveLength(1);
  });
  it("exporting the same request again within ten minutes is one entry in the access log", async () => {
    const w = await world();
    const r = await w.openVerified();
    await exportForRequest(w.hr, r.id);
    await exportForRequest(w.hr, r.id);
    expect((await w.entries()).filter((x) => (x.newValue as { kind: string }).kind === "DATA_EXPORT")).toHaveLength(1);
  });
  it("a person's own copy of their data is not recorded, and neither is an HR person handling their own request", async () => {
    const w = await world();
    const own = ctxOf(await realUser(w.t, "EMPLOYEE", { employeeId: w.emp.id }));
    await exportMyData(own);
    const hrEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Admin", employmentDate: "2022-01-05", categoryId: w.t.officeId });
    const hrSelf: Ctx = { ...w.hr, employeeId: hrEmp.id };
    const r = await w.openVerified(hrEmp.id);
    await exportForRequest(hrSelf, r.id);
    expect(await w.entries()).toHaveLength(0);
  });
  it("if the entry cannot be written, the export fails: nothing is handed over and the request is not marked exported", async () => {
    const w = await world();
    const r = await w.openVerified();
    (logAudit as Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(exportForRequest(w.hr, r.id)).rejects.toThrow(/disk full/);
    const after = await db.dataAccessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.exportedAt).toBeNull();
    expect(await w.entries()).toHaveLength(0);
  });
  it("is refused to someone without the right, with nothing recorded", async () => {
    const w = await world();
    const r = await w.openVerified();
    await expect(exportForRequest(w.t.ctx("PAYROLL_ADMIN"), r.id)).rejects.toThrow();
    expect(await w.entries()).toHaveLength(0);
  });
});

describe("what the auditor sees in the access log", () => {
  it("shows an export by its request number and a register read as a list, never the employee, with the kinds labelled", async () => {
    const w = await world();
    await w.sanction();
    await listSanctions(w.hr, { status: "PENDING" });
    const r = await w.openVerified();
    await exportForRequest(w.hr, r.id);
    const log = await sensitiveAccessLog(w.auditor, {});
    const byKind = Object.fromEntries(log.entries.map((e) => [e.kind, e]));
    expect(byKind.SANCTION).toMatchObject({ employee: null, employeeId: null, ref: "sanction-list", count: 1 });
    expect(byKind.DATA_EXPORT).toMatchObject({ employee: null, employeeId: null, reference: r.requestNumber, recordId: r.id });
    expect(JSON.stringify(log)).not.toMatch(/Zainab|Hiddenname|SECRET/);
    // both count among the records this reader opened, so a day of unusually many is flagged as it is for cases
    expect(log.summary.find((s) => s.userId === w.hr.userId)).toMatchObject({ records: 1 });
  });
  it("is for people who may read the audit log only, and each company sees only its own", async () => {
    const w = await world();
    await w.sanction();
    await listSanctions(w.hr, { status: "PENDING" });
    await expect(sensitiveAccessLog(w.t.ctx("EMPLOYEE"), {})).rejects.toThrow(/permission/i);
    await expect(sensitiveAccessLog(w.t.ctx("SUPERVISOR"), {})).rejects.toThrow(/permission/i);
    const other = await world();
    const theirs = await sensitiveAccessLog(other.auditor, {});
    expect(theirs.entries).toEqual([]);
  });
});

// ───────────────────────────── Governance step 6: the sanctions in an employee's HR history ─────────────────────────────

describe("an employee's HR history shows their approved sanctions", () => {
  /** An approved sanction (raised by HR, signed off by a different person), and a commendation and a pending sanction that the history must not record. */
  async function history() {
    const w = await world();
    const raise = (type: string) => raiseDisciplinary(w.hr, { employeeId: w.emp.id, type, incidentDate: iso(todayUtc()), description: `${SECRET} ${type}` } as never);
    const a = await raise("WRITTEN_WARNING");
    const b = await raise("SUSPENSION");
    const pending = await raise("QUERY");
    const praise = await raise("COMMENDATION");
    for (const r of [a, b, praise]) await approveDisciplinary(w.boss, r.id);
    return { ...w, a, b, pending, praise };
  }

  it("records each sanction it showed by the sanction's own id: who, the kind and the id; never the employee or the words, and not praise or a sanction still waiting", async () => {
    const h = await history();
    const events = await employeeTimeline(h.hr, h.emp.id);
    expect(events.filter((e) => e.kind === "Disciplinary")).toHaveLength(2);
    const rows = (await h.entries()).filter((r) => r.entity === "DisciplinaryRecord");
    expect(rows.map((r) => r.entityId).sort()).toEqual([h.a.id, h.b.id].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ userId: h.hr.userId });
      expect(r.newValue).toMatchObject({ kind: "SANCTION" });
    }
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`Zainab|Hiddenname|SECRET|left his post|${h.emp.id}`));
    expect(rows.map((r) => r.entityId)).not.toContain(h.pending.id);
    expect(rows.map((r) => r.entityId)).not.toContain(h.praise.id);
  });
  it("opening the history again within ten minutes is one entry for each sanction", async () => {
    const h = await history();
    await employeeTimeline(h.hr, h.emp.id);
    await employeeTimeline(h.hr, h.emp.id);
    expect((await h.entries()).filter((r) => r.entity === "DisciplinaryRecord")).toHaveLength(2);
  });
  it("a reader who may not see sanctions is shown none, so records none (praise is still shown)", async () => {
    const h = await history();
    const finance = ctxOf(await realUser(h.t, "FINANCE"));
    const events = await employeeTimeline(finance, h.emp.id);
    expect(events.filter((e) => e.kind === "Disciplinary")).toHaveLength(0);
    expect(events.filter((e) => e.kind === "Commendation")).toHaveLength(1);
    expect((await h.entries()).filter((r) => r.entity === "DisciplinaryRecord")).toHaveLength(0);
  });
  it("looking at your own history is not recorded", async () => {
    const h = await history();
    await employeeTimeline({ ...h.hr, employeeId: h.emp.id }, h.emp.id);
    expect(await h.entries()).toHaveLength(0);
  });
  it("if the entry cannot be written, the history fails and shows nothing", async () => {
    const h = await history();
    (logAudit as Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(employeeTimeline(h.hr, h.emp.id)).rejects.toThrow(/disk full/);
    expect(await h.entries()).toHaveLength(0);
  });
  it("is shown to the auditor by a short sanction reference, never the employee, and counts among the records that reader opened", async () => {
    const h = await history();
    await employeeTimeline(h.hr, h.emp.id);
    const log = await sensitiveAccessLog(h.auditor, {});
    const sanctions = log.entries.filter((e) => e.kind === "SANCTION");
    expect(sanctions).toHaveLength(2);
    for (const e of sanctions) {
      expect(e).toMatchObject({ employee: null, employeeId: null });
      expect(e.reference).toMatch(/^Sanction [a-z0-9]{6}$/);
      expect([h.a.id, h.b.id]).toContain(e.recordId);
    }
    expect(JSON.stringify(log)).not.toMatch(/Zainab|Hiddenname|SECRET/);
    expect(log.summary.find((s) => s.userId === h.hr.userId)).toMatchObject({ records: 2 });
  });
  it("another company's auditor sees none of it", async () => {
    const h = await history();
    await employeeTimeline(h.hr, h.emp.id);
    const other = await world();
    expect((await sensitiveAccessLog(other.auditor, {})).entries).toEqual([]);
  });
});

// ───────────────────────────── Governance step 7: the sanctions on the employee's own profile page ─────────────────────────────

describe("the employee's profile shows their sanctions on the Disciplinary and Letters tabs", () => {
  /** One approved sanction, one still waiting for sign-off, and an approved commendation. */
  async function profile() {
    const w = await world();
    const raise = (type: string) => raiseDisciplinary(w.hr, { employeeId: w.emp.id, type, incidentDate: iso(todayUtc()), description: `${SECRET} ${type}` } as never);
    const approved = await raise("WRITTEN_WARNING");
    const pending = await raise("QUERY");
    const praise = await raise("COMMENDATION");
    for (const r of [approved, praise]) await approveDisciplinary(w.boss, r.id);
    return { ...w, approved, pending, praise };
  }
  const sanctionRows = async (p: Awaited<ReturnType<typeof profile>>) => (await p.entries()).filter((r) => r.entity === "DisciplinaryRecord");

  it("records each sanction it returns by the sanction's own id, the approved one and the one still waiting (the tab shows both); never the employee or the words; not praise", async () => {
    const p = await profile();
    const e = await getEmployee(p.hr, p.emp.id);
    expect(e!.disciplinaryRecords).toHaveLength(3);
    const rows = await sanctionRows(p);
    expect(rows.map((r) => r.entityId).sort()).toEqual([p.approved.id, p.pending.id].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ userId: p.hr.userId });
      expect(r.newValue).toMatchObject({ kind: "SANCTION" });
    }
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`Zainab|Hiddenname|SECRET|left his post|${p.emp.id}`));
    expect(rows.map((r) => r.entityId)).not.toContain(p.praise.id);
  });
  it("a page that is not showing sanctions asks for none and gets none, and records nothing (the praise is still returned)", async () => {
    const p = await profile();
    const e = await getEmployee(p.hr, p.emp.id, { sanctions: false });
    expect(e!.disciplinaryRecords.map((r) => r.type)).toEqual(["COMMENDATION"]);
    expect(await sanctionRows(p)).toHaveLength(0);
  });
  it("is one entry per sanction when the page is opened again within ten minutes", async () => {
    const p = await profile();
    await getEmployee(p.hr, p.emp.id);
    await getEmployee(p.hr, p.emp.id);
    expect(await sanctionRows(p)).toHaveLength(2);
  });
  it("a reader who may not see sanctions is returned none, so records none", async () => {
    const p = await profile();
    const finance = ctxOf(await realUser(p.t, "FINANCE"));
    const e = await getEmployee(finance, p.emp.id);
    expect(e!.disciplinaryRecords.map((r) => r.type)).toEqual(["COMMENDATION"]);
    expect(await sanctionRows(p)).toHaveLength(0);
  });
  it("looking at your own profile is not recorded", async () => {
    const p = await profile();
    await getEmployee({ ...p.hr, employeeId: p.emp.id }, p.emp.id);
    expect(await p.entries()).toHaveLength(0);
  });
  it("another company's employee is not found and records nothing", async () => {
    const p = await profile();
    const other = await world();
    expect(await getEmployee(other.hr, p.emp.id)).toBeNull();
    expect(await other.entries()).toHaveLength(0);
  });
  it("if the entry cannot be written, the profile fails and shows nothing", async () => {
    const p = await profile();
    (logAudit as Mock).mockRejectedValueOnce(new Error("disk full"));
    await expect(getEmployee(p.hr, p.emp.id)).rejects.toThrow(/disk full/);
    expect(await p.entries()).toHaveLength(0);
  });
  it("is shown to the auditor by a short sanction reference, never the employee", async () => {
    const p = await profile();
    await getEmployee(p.hr, p.emp.id);
    const log = await sensitiveAccessLog(p.auditor, {});
    const rows = log.entries.filter((e) => e.kind === "SANCTION");
    expect(rows).toHaveLength(2);
    for (const e of rows) expect(e).toMatchObject({ employee: null, employeeId: null, reference: expect.stringMatching(/^Sanction [a-z0-9]{6}$/) });
    expect(JSON.stringify(log)).not.toMatch(/Zainab|Hiddenname|SECRET/);
  });
});
