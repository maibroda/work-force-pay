import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import type { Ctx } from "@/lib/auth/context";
import { isolatedOrg, uid } from "../helpers";
import { todayUtc } from "@/server/services/hr-policy";
import { beginTotpEnrollment, confirmTotpEnrollment, disableTotp, getTwoFactorRequirement, resetUserTwoFactor, setTwoFactorRequirement, verifyTotpLogin } from "@/server/services/security";

/** Real users (the helper's contexts have invented ids) in a throwaway organization. */
async function world() {
  const t = await isolatedOrg();
  await db.hrPolicy.upsert({ where: { organizationId: t.org.id }, update: {}, create: { organizationId: t.org.id } });
  const make = async (role: Ctx["role"], n = 1) => {
    const email = `${role.toLowerCase()}${n}.${uid()}@test.local`;
    const u = await db.user.create({ data: { organizationId: t.org.id, email, name: `${role} ${n}`, passwordHash: await bcrypt.hash("Password123!", 4), role } });
    const ctx: Ctx = { userId: u.id, orgId: t.org.id, role, name: u.name, email, employeeId: null };
    return { u, ctx };
  };
  const enrol = async (ctx: Ctx) => {
    const { secret } = await beginTotpEnrollment(ctx);
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
    await confirmTotpEnrollment(ctx, code);
  };
  return { t, make, enrol };
}

const today = () => iso(todayUtc());

describe("setting the requirement", () => {
  it("is off by default, and covers only the roles chosen", async () => {
    const { make } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("NOT_REQUIRED");
    const before = await getTwoFactorRequirement(admin.ctx);
    expect(before.roles).toEqual([]);
    expect(before.enforceFrom).toBeNull();
  });

  it("needs a start day when roles are chosen, and a real role", async () => {
    const { make } = await world();
    const admin = await make("COMPANY_ADMIN");
    await expect(setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"] })).rejects.toThrow(/first day/i);
    await expect(setTwoFactorRequirement(admin.ctx, { roles: ["WIZARD"], enforceFrom: today() })).rejects.toThrow(/isn't a role/i);
  });

  it("is for user administrators only, and is audited", async () => {
    const { t, make } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    await expect(setTwoFactorRequirement(hr.ctx, { roles: ["HR_ADMIN"], enforceFrom: iso(addDays(todayUtc(), 30)) })).rejects.toThrow(/permission/i);
    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: iso(addDays(todayUtc(), 30)) });
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "TWO_FACTOR_REQUIREMENT" } })).toBe(1);
  });

  it("won't let you lock yourself out: your own role, due now, and you haven't set it up", async () => {
    const { make, enrol } = await world();
    const admin = await make("COMPANY_ADMIN");
    await expect(setTwoFactorRequirement(admin.ctx, { roles: ["COMPANY_ADMIN"], enforceFrom: today() })).rejects.toThrow(/lock you out/i);
    // a future start day is fine — there is time to enrol — and so is enrolling first
    await setTwoFactorRequirement(admin.ctx, { roles: ["COMPANY_ADMIN"], enforceFrom: iso(addDays(todayUtc(), 7)) });
    await enrol(admin.ctx);
    await setTwoFactorRequirement(admin.ctx, { roles: ["COMPANY_ADMIN"], enforceFrom: today() });
    expect((await twoFactorStateFor(admin.ctx)).state).toBe("ENROLLED");
  });

  it("can be switched off by clearing the roles", async () => {
    const { make } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: today() });
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("BLOCKED");
    await setTwoFactorRequirement(admin.ctx, { roles: [] });
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("NOT_REQUIRED");
    expect((await getTwoFactorRequirement(admin.ctx)).enforceFrom).toBeNull();
  });
});

describe("what each person sees", () => {
  it("reminds before the start day, blocks from it, and clears once they enrol", async () => {
    const { make, enrol } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    const finance = await make("FINANCE");
    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: iso(addDays(todayUtc(), 10)) });
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("GRACE");
    expect((await twoFactorStateFor(finance.ctx)).state).toBe("NOT_REQUIRED");

    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: today() });
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("BLOCKED");
    expect((await twoFactorStateFor(finance.ctx)).state).toBe("NOT_REQUIRED");

    await enrol(hr.ctx);
    expect((await twoFactorStateFor(hr.ctx)).state).toBe("ENROLLED");
  });

  it("is per organization", async () => {
    const a = await world();
    const b = await world();
    const adminA = await a.make("COMPANY_ADMIN");
    const hrB = await b.make("HR_ADMIN");
    await setTwoFactorRequirement(adminA.ctx, { roles: ["HR_ADMIN"], enforceFrom: today() });
    expect((await twoFactorStateFor(hrB.ctx)).state).toBe("NOT_REQUIRED");
  });

  it("lists who in the chosen roles still has to set it up", async () => {
    const { make, enrol } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr1 = await make("HR_ADMIN", 1);
    const hr2 = await make("HR_ADMIN", 2);
    await make("FINANCE");
    await enrol(hr1.ctx);
    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: today() });
    const r = await getTwoFactorRequirement(admin.ctx);
    expect(r.covered).toBe(2);
    expect(r.missing).toBe(1);
    expect(r.rows.find((x) => x.id === hr2.u.id)?.state).toBe("BLOCKED");
    expect(r.rows.find((x) => x.id === hr1.u.id)?.state).toBe("ENROLLED");
  });
});

describe("turning it off yourself", () => {
  it("is refused when your role must use it, allowed when it doesn't", async () => {
    const { make, enrol } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    const finance = await make("FINANCE");
    await enrol(hr.ctx);
    await enrol(finance.ctx);
    await setTwoFactorRequirement(admin.ctx, { roles: ["HR_ADMIN"], enforceFrom: today() });
    await expect(disableTotp(hr.ctx, "000000")).rejects.toThrow(/must sign in with two-factor/i);
    // finance isn't covered: the normal rules apply (a wrong code is refused)
    await expect(disableTotp(finance.ctx, "000000")).rejects.toThrow(/incorrect code/i);
  });
});

describe("resetting someone who lost their phone", () => {
  it("switches theirs off, signs them out everywhere, and records why", async () => {
    const { t, make, enrol } = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    await enrol(hr.ctx);
    const before = await db.user.findUniqueOrThrow({ where: { id: hr.u.id } });
    expect(before.totpEnabled).toBe(true);
    await resetUserTwoFactor(admin.ctx, hr.u.id, "Lost phone and backup codes; confirmed by phone call to their manager.");
    const after = await db.user.findUniqueOrThrow({ where: { id: hr.u.id } });
    expect(after.totpEnabled).toBe(false);
    expect(after.totpSecret).toBeNull();
    expect(after.backupCodes).toEqual([]);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(await verifyTotpLogin(hr.u.id, "123456")).toBe(false);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, action: "TWO_FACTOR_RESET", entityId: hr.u.id } });
    expect(audit.reason).toMatch(/Lost phone/);
  });

  it("is refused for yourself, without a proper reason, for a user with nothing to reset, for other organizations, and for non-administrators", async () => {
    const { make, enrol } = await world();
    const other = await world();
    const admin = await make("COMPANY_ADMIN");
    const hr = await make("HR_ADMIN");
    const stranger = await other.make("HR_ADMIN");
    await enrol(admin.ctx);
    await enrol(hr.ctx);
    await enrol(stranger.ctx);
    await expect(resetUserTwoFactor(admin.ctx, admin.u.id, "I have lost my own phone so please reset it")).rejects.toThrow(/your own/i);
    await expect(resetUserTwoFactor(admin.ctx, hr.u.id, "lost")).rejects.toThrow(/say why/i);
    await expect(resetUserTwoFactor(admin.ctx, stranger.u.id, "Lost phone and backup codes, verified in person.")).rejects.toThrow(/not found/i);
    await expect(resetUserTwoFactor(hr.ctx, admin.u.id, "Lost phone and backup codes, verified in person.")).rejects.toThrow(/permission/i);
    const finance = await make("FINANCE");
    await expect(resetUserTwoFactor(admin.ctx, finance.u.id, "Lost phone and backup codes, verified in person.")).rejects.toThrow(/don't have two-factor/i);
  });
});
