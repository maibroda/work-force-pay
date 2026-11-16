import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertSeedTarget, checkSeedTarget } from "@/lib/seed-guard";

// The demo seed TRUNCATES every table. This guard is what stops it being run, by mistake, against a real database (decision H3 of the founder's review, 2026-11-14).
// A local database with a non-production environment is allowed as before; anything else is refused unless the person types the database's own name as a confirmation.

const local = "postgresql://postgres:secret-pw@localhost:5432/workforcepay?schema=public";
const run = (env: Record<string, string | undefined>) => checkSeedTarget(env);

describe("the seed guard allows what the seed was always used for", () => {
  it("a database on this machine, when the environment is not production", () => {
    for (const url of [local, "postgresql://u:p@127.0.0.1:5432/workforcepay_test", "postgresql://u:p@[::1]:5432/demo"]) {
      expect(run({ DATABASE_URL: url }), url).toMatchObject({ ok: true });
      expect(run({ DATABASE_URL: url, NODE_ENV: "test" }), url).toMatchObject({ ok: true });
      expect(run({ DATABASE_URL: url, NODE_ENV: "development" }), url).toMatchObject({ ok: true });
    }
  });
  it("names the target (database and host) without the password", () => {
    const r = run({ DATABASE_URL: local });
    expect(r).toEqual({ ok: true, target: "workforcepay on localhost", confirmed: false });
    expect(JSON.stringify(r)).not.toContain("secret-pw");
  });
});

describe("the seed guard refuses what could destroy a real database", () => {
  it("refuses when the environment is production, even for a local database", () => {
    const r = run({ DATABASE_URL: local, NODE_ENV: "production" });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/production/i);
  });
  it("refuses a database that is not on this machine, and says which host", () => {
    for (const host of ["db.example.com", "10.0.0.5", "host.docker.internal", "localhost.example.com"]) {
      const r = run({ DATABASE_URL: `postgresql://u:p@${host}:5432/payroll` });
      expect(r.ok, host).toBe(false);
      expect((r as { reason: string }).reason, host).toContain(host);
    }
  });
  it("refuses a database reached through a socket or host given as a parameter that is not local", () => {
    expect(run({ DATABASE_URL: "postgresql://u:p@localhost/payroll?host=db.example.com" }).ok).toBe(false);
  });
  it("refuses when there is no database address, or one that cannot be read, without printing it", () => {
    expect(run({}).ok).toBe(false);
    const r = run({ DATABASE_URL: "not a url with secret-token" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secret-token");
  });
  it("never prints the password, the user or the full address in its refusal", () => {
    const r = run({ DATABASE_URL: "postgresql://admin:hunter2@db.example.com:5432/payroll", NODE_ENV: "production" });
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/hunter2|admin|postgresql:\/\//);
    expect(text).toContain("payroll");
  });
});

describe("the explicit confirmation", () => {
  const remote = "postgresql://u:p@db.example.com:5432/payroll_demo";
  it("allows a refused target only when the confirmation is exactly the database's name", () => {
    expect(run({ DATABASE_URL: remote, SEED_CONFIRM_RESET: "payroll_demo" })).toMatchObject({ ok: true, confirmed: true });
    expect(run({ DATABASE_URL: local, NODE_ENV: "production", SEED_CONFIRM_RESET: "workforcepay" })).toMatchObject({ ok: true, confirmed: true });
  });
  it("is not satisfied by a yes, a true, another database's name, a different case or an empty value", () => {
    for (const v of ["yes", "true", "1", "payroll", "PAYROLL_DEMO", "payroll_demo ", ""]) expect(run({ DATABASE_URL: remote, SEED_CONFIRM_RESET: v }).ok, v).toBe(false);
  });
  it("tells the person how to confirm, naming the database", () => {
    const r = run({ DATABASE_URL: remote });
    expect((r as { reason: string }).reason).toContain("SEED_CONFIRM_RESET=payroll_demo");
  });
  it("is not needed, and not reported as used, for an ordinary local run", () => {
    expect(run({ DATABASE_URL: local, SEED_CONFIRM_RESET: "workforcepay" })).toMatchObject({ ok: true, confirmed: false });
  });
});

describe("assertSeedTarget", () => {
  it("returns the target to print, or throws the refusal", () => {
    expect(assertSeedTarget({ DATABASE_URL: local })).toBe("workforcepay on localhost");
    expect(() => assertSeedTarget({ DATABASE_URL: local, NODE_ENV: "production" })).toThrow(/Refusing to reset/);
  });
});

describe("the seed script itself", () => {
  // The script is started for real with an address nothing listens on: if the guard works it stops BEFORE connecting; if it did not, it would fail on the connection, never reach a table.
  const seed = (env: Record<string, string>) => {
    try {
      execFileSync("npx", ["tsx", "prisma/seed.ts"], { env: { ...process.env, ...env, DOTENV_CONFIG_QUIET: "true" }, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32", timeout: 120_000 });
      return { code: 0, text: "" };
    } catch (e) {
      const err = e as { status?: number; stderr?: string; stdout?: string };
      return { code: err.status ?? 1, text: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };
  it("stops with the refusal in production, before it connects, and does not print the password", () => {
    const r = seed({ NODE_ENV: "production", DATABASE_URL: "postgresql://postgres:never-print-me@localhost:1/guard_check" });
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/Refusing to reset database "guard_check"/);
    expect(r.text).not.toContain("never-print-me");
    expect(r.text).not.toMatch(/Resetting database/);
  });
  it("stops with the refusal for a database that is not local", () => {
    const r = seed({ DATABASE_URL: "postgresql://postgres:never-print-me@db.example.invalid:5432/guard_check" });
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/Refusing to reset database "guard_check" on db\.example\.invalid/);
    expect(r.text).not.toContain("never-print-me");
  });
}, 300_000);
