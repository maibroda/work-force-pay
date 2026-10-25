import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import type { Ctx } from "@/lib/auth/context";
import { bringForwardStaffTwoFactor, enableBureau, grantAccess, onboardClient, staffTwoFactorStatus } from "@/server/services/bureau";
import { beginTotpEnrollment, confirmTotpEnrollment, disableTotp } from "@/server/services/security";
import { todayUtc } from "@/server/services/hr-policy";
import { isolatedOrg, uid } from "../helpers";

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@bureau.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: await bcrypt.hash("Password123!", 4) } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}
const enrol = async (ctx: Ctx) => {
  const { secret } = await beginTotpEnrollment(ctx);
  await confirmTotpEnrollment(ctx, new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate());
};
const setFrom = (orgId: string, day: Date) => db.$executeRaw`UPDATE "Organization" SET "staffTwoFactorFrom" = ${day} WHERE id = ${orgId}`;

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  await enableBureau(founder);
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const org = () => db.organization.findUniqueOrThrow({ where: { id: t.org.id } });
  return { t, founder, officer, org };
}

describe("two-factor for a bureau's staff", () => {
  it("gives a new bureau 14 days' notice, and covers every role in it", async () => {
    const { org, officer } = await world();
    expect(iso((await org()).staffTwoFactorFrom!)).toBe(iso(addDays(todayUtc(), 14)));
    const s = await twoFactorStateFor(officer);
    expect(s.state).toBe("GRACE");
    expect(iso(s.enforceFrom!)).toBe(iso(addDays(todayUtc(), 14)));
  });

  it("locks out anyone who hasn't set it up once the day arrives, and lets enrolled staff through", async () => {
    const { t, founder, officer } = await world();
    await setFrom(t.org.id, todayUtc());
    expect((await twoFactorStateFor(officer)).state).toBe("BLOCKED");
    await enrol(officer);
    expect((await twoFactorStateFor(officer)).state).toBe("ENROLLED");
    expect((await twoFactorStateFor(founder)).state).toBe("BLOCKED");
  });

  it("follows the person into a client organization", async () => {
    const { t, founder, officer } = await world();
    const c = await onboardClient(founder, { name: `Client ${uid()}`, code: `C${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-11-01", termMonths: 12, perEmployeeRate: 1500, monthlyMinimum: 50000, onboardingFee: 0 } as never);
    await grantAccess(founder, officer.userId, c.client.id);
    await setFrom(t.org.id, todayUtc());
    // working in the client: the session's organization is the client, but the person is still the bureau's
    expect((await twoFactorStateFor({ userId: officer.userId, orgId: c.client.id, role: officer.role })).state).toBe("BLOCKED");
    await enrol(officer);
    expect((await twoFactorStateFor({ userId: officer.userId, orgId: c.client.id, role: officer.role })).state).toBe("ENROLLED");
  });

  it("does not touch the staff of an ordinary organization", async () => {
    const t = await isolatedOrg();
    const hr = await person(t.org.id, "HR_ADMIN", "hr");
    expect((await twoFactorStateFor(hr)).state).toBe("NOT_REQUIRED");
  });

  it("can't be turned off by staff once it applies", async () => {
    const { t, officer } = await world();
    await enrol(officer);
    await setFrom(t.org.id, todayUtc());
    const secret = (await db.user.findUniqueOrThrow({ where: { id: officer.userId } })).totpSecret!;
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
    await expect(disableTotp(officer, code)).rejects.toThrow(/must sign in with two-factor/);
  });
});

describe("the bureau's start day", () => {
  it("can be brought forward by a manager, with a record, but not put back", async () => {
    const { t, founder, org } = await world();
    await enrol(founder);
    const sooner = iso(addDays(todayUtc(), 3));
    await bringForwardStaffTwoFactor(founder, { from: sooner });
    expect(iso((await org()).staffTwoFactorFrom!)).toBe(sooner);
    const log = await db.auditLog.findFirst({ where: { organizationId: t.org.id, action: "BUREAU_STAFF_TWO_FACTOR_FROM" } });
    expect(log?.newValue).toMatchObject({ from: sooner });
    await expect(bringForwardStaffTwoFactor(founder, { from: iso(addDays(todayUtc(), 10)) })).rejects.toThrow(/brought forward/);
  });

  it("is for bureau managers only", async () => {
    const { officer } = await world();
    await expect(bringForwardStaffTwoFactor(officer, { from: iso(todayUtc()) })).rejects.toThrow(/permission/);
  });

  it("won't let a manager lock themselves out by making it effective today", async () => {
    const { founder } = await world();
    await expect(bringForwardStaffTwoFactor(founder, { from: iso(todayUtc()) })).rejects.toThrow(/Turn on two-factor for your own account first/);
    await enrol(founder);
    await bringForwardStaffTwoFactor(founder, { from: iso(todayUtc()) });
  });

  it("is refused by the database too if anyone tries to put it back or remove it", async () => {
    const { t } = await world();
    await expect(db.$executeRaw`UPDATE "Organization" SET "staffTwoFactorFrom" = CURRENT_DATE + 60 WHERE id = ${t.org.id}`).rejects.toThrow(/brought forward/);
    await expect(db.$executeRaw`UPDATE "Organization" SET "staffTwoFactorFrom" = NULL WHERE id = ${t.org.id}`).rejects.toThrow(/switched off/);
  });

  it("shows who has and hasn't set it up", async () => {
    const { founder, officer } = await world();
    await enrol(officer);
    const s = await staffTwoFactorStatus(founder);
    expect(s.rows.find((r) => r.id === officer.userId)?.state).toBe("ENROLLED");
    expect(s.rows.find((r) => r.id === founder.userId)?.state).toBe("GRACE");
    expect(s.missing).toBe(1);
    expect(s.inForce).toBe(false);
  });
});
