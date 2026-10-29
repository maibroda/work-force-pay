import { describe, expect, it } from "vitest";
import { checkAppUrl, checkAuditSeal, checkEmail, checkRules, checkScheduler, checkSecrets, JOBS, MANUAL_CHECKS, RATE_POINTS, SCHEDULER_MAX_AGE_HOURS, summarise, type JobRunRow } from "@/lib/launch-readiness";

const now = new Date("2026-10-26T09:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const run = (name: string, h: number, ok = true, error: string | null = null): JobRunRow => ({ name, startedAt: hoursAgo(h), ok, error });

describe("email", () => {
  it("is not done without a key, or while sending from Resend's test address", () => {
    expect(checkEmail({}).status).toBe("TODO");
    expect(checkEmail({}).evidence).toHaveLength(2);
    expect(checkEmail({ RESEND_API_KEY: "re_x" }).evidence[0]).toMatch(/EMAIL_FROM is not set/);
    expect(checkEmail({ RESEND_API_KEY: "re_x", EMAIL_FROM: "WorkforcePay <onboarding@resend.dev>" }).evidence[0]).toMatch(/test address/);
  });
  it("is done with a key and an address of your own", () => {
    const r = checkEmail({ RESEND_API_KEY: "re_x", EMAIL_FROM: "ThreeRoots <payroll@threeroots.ng>" });
    expect(r.status).toBe("DONE");
    expect(r.evidence[0]).toContain("payroll@threeroots.ng");
  });
});

describe("the public address", () => {
  it("must be set, https, and not local", () => {
    expect(checkAppUrl({}).status).toBe("TODO");
    expect(checkAppUrl({ APP_URL: "http://app.threeroots.ng" }).status).toBe("TODO");
    expect(checkAppUrl({ APP_URL: "https://localhost:3000" }).status).toBe("TODO");
    expect(checkAppUrl({ APP_URL: "https://127.0.0.1" }).status).toBe("TODO");
    expect(checkAppUrl({ APP_URL: "https://app.threeroots.ng" }).status).toBe("DONE");
  });
});

describe("the secrets", () => {
  const real = "k3Jd9sLq2PzX7vBn4RtYw8UeA1oCmF6h";
  it("refuses missing, short and placeholder secrets", () => {
    expect(checkSecrets({}).evidence).toHaveLength(2);
    expect(checkSecrets({ AUTH_SECRET: "short", CRON_SECRET: real }).evidence[0]).toMatch(/AUTH_SECRET/);
    expect(checkSecrets({ AUTH_SECRET: "change-me-to-a-long-random-secret-string-of-at-least-32-chars", CRON_SECRET: real }).evidence[0]).toMatch(/placeholder/);
    expect(checkSecrets({ AUTH_SECRET: "ci-only-secret-not-for-production-use-minimum-32-characters", CRON_SECRET: real }).evidence[0]).toMatch(/placeholder/);
    expect(checkSecrets({ AUTH_SECRET: real, CRON_SECRET: "tiny" }).evidence[0]).toMatch(/CRON_SECRET/);
  });
  it("accepts real ones", () => {
    expect(checkSecrets({ AUTH_SECRET: real, CRON_SECRET: real }).status).toBe("DONE");
  });
});

describe("the scheduler", () => {
  it("is to do when nothing has ever called a job, and lists every job", () => {
    const r = checkScheduler([], now);
    expect(r.status).toBe("TODO");
    expect(r.evidence.length).toBe(JOBS.length + 1);
    expect(r.evidence.join(" ")).toMatch(/Payroll reminders \(required\): has never run/);
  });
  it("is done when the reminders ran recently, including over a weekend", () => {
    expect(checkScheduler([run("payroll-reminders", 3)], now).status).toBe("DONE");
    expect(checkScheduler([run("payroll-reminders", SCHEDULER_MAX_AGE_HOURS - 1)], now).status).toBe("DONE");
  });
  it("needs attention when the reminders stopped or failed", () => {
    const stale = checkScheduler([run("payroll-reminders", SCHEDULER_MAX_AGE_HOURS + 5)], now);
    expect(stale.status).toBe("ATTENTION");
    expect(stale.evidence[0]).toMatch(/may have stopped/);
    const failed = checkScheduler([run("payroll-reminders", 2, false, "smtp down")], now);
    expect(failed.status).toBe("ATTENTION");
    expect(failed.evidence.join(" ")).toContain("FAILED");
    expect(failed.evidence.join(" ")).toContain("smtp down");
  });
  it("judges by the reminders only; the other jobs are information", () => {
    expect(checkScheduler([run("payroll-reminders", 1), run("hr-digest", 500, false, "x")], now).status).toBe("DONE");
    expect(checkScheduler([run("hr-digest", 1)], now).status).toBe("TODO");
  });
});

describe("the rate tables", () => {
  const rule = (label: string, release: "PROPOSED" | "VERIFIED" | "PUBLISHED" | null, verifications = 0) => ({ label, release, verifications });
  it("are done only when every table in force is published", () => {
    expect(checkRules([rule("PAYE x", "PUBLISHED"), rule("Pension v1", "PUBLISHED")], []).status).toBe("DONE");
  });
  it("are to do when one was never put through verification, or a whole kind is missing", () => {
    const r = checkRules([rule("PAYE x", "PUBLISHED"), rule("Pension v1", null)], []);
    expect(r.status).toBe("TODO");
    expect(r.evidence).toEqual(["Pension v1 was never put through verification."]);
    const missing = checkRules([rule("PAYE x", "PUBLISHED")], ["pension"]);
    expect(missing.status).toBe("TODO");
    expect(missing.evidence[0]).toMatch(/no pension rule in force/);
  });
  it("need attention while a release is under way, saying how far", () => {
    const r = checkRules([rule("PAYE x", "PROPOSED", 1), rule("Pension v1", "VERIFIED", 2)], []);
    expect(r.status).toBe("ATTENTION");
    expect(r.evidence[0]).toMatch(/1 of 2 signed/);
    expect(r.evidence[1]).toMatch(/not yet published/);
  });
  it("are to do, not just attention, if anything is still untouched", () => {
    expect(checkRules([rule("PAYE x", "PROPOSED", 0), rule("Pension v1", null)], []).status).toBe("TODO");
  });
});

describe("the checklist", () => {
  it("counts done items and is ready only when all are", () => {
    expect(summarise([{ status: "DONE" }, { status: "TODO" }])).toEqual({ done: 1, total: 2, ready: false });
    expect(summarise([{ status: "DONE" }, { status: "DONE" }])).toEqual({ done: 2, total: 2, ready: true });
    expect(summarise([]).ready).toBe(false);
  });
  it("has unique manual items, each saying what to do, and points for the rate verifiers", () => {
    expect(new Set(MANUAL_CHECKS.map((c) => c.key)).size).toBe(MANUAL_CHECKS.length);
    for (const c of MANUAL_CHECKS) expect(c.how.length).toBeGreaterThan(40);
    expect(RATE_POINTS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the audit seal", () => {
  const KEY = "k3Jd9sLq2PzX7vBn4RtYw8UeA1oCmF6hZ0qWxE5c";
  it("is to do without a real key, saying why and never repeating the key", () => {
    expect(checkAuditSeal({}, [], now).status).toBe("TODO");
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: "short" }, [], now).evidence[0]).toMatch(/shorter than 32/);
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: "short" }, [], now).evidence.join()).not.toContain("short\"");
    const placeholder = checkAuditSeal({ AUDIT_SEAL_KEY: "change-me-generate-a-long-random-string-of-at-least-32-chars" }, [], now);
    expect(placeholder.status).toBe("TODO");
    expect(placeholder.evidence[0]).toMatch(/placeholder/);
  });
  it("is to do while the sealing job has never run", () => {
    const r = checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [], now);
    expect(r.status).toBe("TODO");
    expect(r.evidence[0]).toMatch(/never run/);
  });
  it("is done when sealing ran in the last day and the daily check ran fine", () => {
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [run("audit-seal", 0.1), run("audit-verify", 5)], now).status).toBe("DONE");
  });
  it("needs attention when sealing failed or went quiet, or the daily check failed or has never run", () => {
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [run("audit-seal", 0.1, false, "boom"), run("audit-verify", 5)], now).status).toBe("ATTENTION");
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [run("audit-seal", 30), run("audit-verify", 5)], now).status).toBe("ATTENTION");
    expect(checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [run("audit-seal", 0.1), run("audit-verify", 5, false, "found problems")], now).status).toBe("ATTENTION");
    const never = checkAuditSeal({ AUDIT_SEAL_KEY: KEY }, [run("audit-seal", 0.1)], now);
    expect(never.status).toBe("ATTENTION");
    expect(never.evidence.join()).toMatch(/daily check has never run/);
  });
});
