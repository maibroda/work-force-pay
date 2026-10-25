import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { logAudit } from "@/server/services/audit";
import { isolatedOrg } from "../helpers";

async function entry() {
  const t = await isolatedOrg();
  const ctx = t.ctx("COMPANY_ADMIN");
  await logAudit(ctx, { action: "TEST_ENTRY", entity: "Test", entityId: "x", newValue: { accountNumber: "0123456789" } });
  const row = await db.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, action: "TEST_ENTRY" } });
  return { t, row };
}

describe("the audit log is append-only", () => {
  it("accepts new entries", async () => {
    const { row } = await entry();
    expect(row.newValue).toMatchObject({ accountNumber: "0123456789" });
  });

  it("refuses to change an entry, through the application's client or anything else", async () => {
    const { row } = await entry();
    await expect(db.auditLog.update({ where: { id: row.id }, data: { reason: "tidied up" } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`UPDATE "AuditLog" SET "userName" = 'Someone else' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).userName).toBe(row.userName);
  });

  it("refuses to delete an entry", async () => {
    const { t, row } = await entry();
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({ where: { organizationId: t.org.id } })).rejects.toThrow(/append-only/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id } })).toBe(1);
  });

  it("allows a deliberate redaction only inside a transaction that says so", async () => {
    const { row } = await entry();
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('wfp.allow_audit_redaction', 'on', true)`;
      await tx.auditLog.update({ where: { id: row.id }, data: { newValue: { accountNumber: "******6789" } } });
    });
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).newValue).toMatchObject({ accountNumber: "******6789" });
    // the permission ended with the transaction
    await expect(db.auditLog.update({ where: { id: row.id }, data: { reason: "again" } })).rejects.toThrow(/append-only/);
  });
});
