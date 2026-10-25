import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordSensitiveAccess, sensitiveAccessLog, SENSITIVE_VIEW } from "@/server/services/sensitive-access";
import { isolatedOrg } from "../helpers";

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  hr.name = "Hannah HR";
  const auditor = t.ctx("AUDITOR");
  const employee = await db.employee.create({ data: { organizationId: t.org.id, employeeNumber: "EMP-000001", firstName: "Ada", lastName: "Obi", employmentDate: new Date("2025-01-01T00:00:00Z"), categoryId: t.officeId } });
  return { t, hr, auditor, employee };
}
const entries = (orgId: string) => db.auditLog.findMany({ where: { organizationId: orgId, action: SENSITIVE_VIEW }, orderBy: { createdAt: "asc" } });

describe("recording who looked", () => {
  it("writes an entry under the person's own name, for the employee they opened", async () => {
    const { t, hr, employee } = await world();
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id });
    const [row] = await entries(t.org.id);
    expect(row).toMatchObject({ userId: hr.userId, userName: "Hannah HR", entity: "Employee", entityId: employee.id });
    expect(row.newValue).toMatchObject({ kind: "IDENTIFIERS" });
  });

  it("records a list with how many people were on it", async () => {
    const { t, hr } = await world();
    await recordSensitiveAccess(hr, { kind: "BANK", count: 42 });
    const [row] = await entries(t.org.id);
    expect(row).toMatchObject({ entity: "SensitiveList", entityId: null });
    expect(row.newValue).toMatchObject({ kind: "BANK", count: 42 });
  });

  it("counts opening the same thing again within ten minutes as one, but not after, nor a different thing", async () => {
    const { t, hr, employee } = await world();
    const now = new Date();
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id, now });
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id, now });
    expect(await entries(t.org.id)).toHaveLength(1);
    await recordSensitiveAccess(hr, { kind: "PERSONAL_RECORDS", employeeId: employee.id, now });
    expect(await entries(t.org.id)).toHaveLength(2);
    // the earlier entry is now more than ten minutes old
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id, now: new Date(now.getTime() + 11 * 60_000) });
    expect(await entries(t.org.id)).toHaveLength(3);
  });

  it("doesn't merge different people's visits", async () => {
    const { t, hr, employee } = await world();
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id });
    await recordSensitiveAccess(t.ctx("HR_ADMIN", null, 2), { kind: "IDENTIFIERS", employeeId: employee.id });
    expect(await entries(t.org.id)).toHaveLength(2);
  });

  it("doesn't record someone looking at their own record", async () => {
    const { t, hr, employee } = await world();
    await recordSensitiveAccess({ ...hr, employeeId: employee.id }, { kind: "IDENTIFIERS", employeeId: employee.id });
    expect(await entries(t.org.id)).toHaveLength(0);
  });

  it("tags bureau staff working inside a client", async () => {
    const { t, hr, employee } = await world();
    await recordSensitiveAccess({ ...hr, homeOrgId: "bureau-org" }, { kind: "PAYSLIP", employeeId: employee.id });
    const [row] = await entries(t.org.id);
    expect(row.metadata).toMatchObject({ bureau: "bureau-org" });
    const log = await sensitiveAccessLog(t.ctx("AUDITOR"));
    expect(log.entries[0].fromBureau).toBe(true);
  });
});

describe("reading the record", () => {
  it("is for people who may view the audit log, and only shows this organization's entries", async () => {
    const { t, hr, auditor, employee } = await world();
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id });
    await expect(sensitiveAccessLog(t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/);

    const log = await sensitiveAccessLog(auditor);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ userName: "Hannah HR", kind: "IDENTIFIERS" });
    expect(log.entries[0].employee).toContain(employee.employeeNumber);

    const other = await isolatedOrg();
    expect((await sensitiveAccessLog(other.ctx("AUDITOR"))).entries).toHaveLength(0);
  });

  it("filters by person, by kind and by how far back", async () => {
    const { hr, auditor, employee } = await world();
    await recordSensitiveAccess(hr, { kind: "IDENTIFIERS", employeeId: employee.id });
    await recordSensitiveAccess(hr, { kind: "BANK", count: 3 });
    expect((await sensitiveAccessLog(auditor, { kind: "BANK" })).entries).toHaveLength(1);
    expect((await sensitiveAccessLog(auditor, { kind: "NOT_A_KIND" })).entries).toHaveLength(2);
    expect((await sensitiveAccessLog(auditor, { userId: hr.userId })).entries).toHaveLength(2);
    expect((await sensitiveAccessLog(auditor, { userId: "somebody-else" })).entries).toHaveLength(0);
  });

  it("summarises per person: employees opened one by one, and lists", async () => {
    const { hr, auditor } = await world();
    await recordSensitiveAccess(hr, { kind: "BANK", count: 10 });
    await recordSensitiveAccess(hr, { kind: "TAX", count: 10 });
    const log = await sensitiveAccessLog(auditor);
    expect(log.summary).toHaveLength(1);
    expect(log.summary[0]).toMatchObject({ userName: "Hannah HR", employees: 0, lists: 2 });
  });
});
