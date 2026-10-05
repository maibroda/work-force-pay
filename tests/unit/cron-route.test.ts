import { afterEach, describe, expect, it, vi } from "vitest";

const { run } = vi.hoisted(() => ({
  run: vi.fn(async () => [{ organization: "Test", sent: 1, total: 2, recipients: ["a@b.test"], failed: [] }]),
}));
vi.mock("@/server/services/reminders", () => ({ runDigestForAllOrgs: run }));

import { GET, POST } from "@/app/api/cron/hr-digest/route";

const call = (handler: typeof GET, auth?: string) =>
  handler(new Request("http://localhost/api/cron/hr-digest", { headers: auth ? { authorization: auth } : {} }));

afterEach(() => {
  delete process.env.CRON_SECRET;
  run.mockClear();
});

describe("/api/cron/hr-digest", () => {
  it("is switched off when no CRON_SECRET is configured", async () => {
    const res = await call(GET, "Bearer anything");
    expect(res.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or wrong secret", async () => {
    process.env.CRON_SECRET = "correct-horse-battery";
    expect((await call(GET)).status).toBe(401);
    expect((await call(GET, "correct-horse-battery")).status).toBe(401); // no "Bearer"
    expect((await call(GET, "Bearer wrong-secret-here")).status).toBe(401);
    expect((await call(GET, "Bearer correct-horse-batterz")).status).toBe(401); // same length, one character off
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the job for the right secret, on GET and POST", async () => {
    process.env.CRON_SECRET = "correct-horse-battery";
    for (const handler of [GET, POST]) {
      const res = await call(handler, "Bearer correct-horse-battery");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.results[0]).toMatchObject({ organization: "Test", sent: 1 });
    }
    expect(run).toHaveBeenCalledTimes(2);
  });
});
