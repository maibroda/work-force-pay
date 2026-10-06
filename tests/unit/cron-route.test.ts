import { afterEach, describe, expect, it, vi } from "vitest";

const { digest, retain } = vi.hoisted(() => ({
  digest: vi.fn(async () => [{ organization: "Test", sent: 1, total: 2, recipients: ["a@b.test"], failed: [] }]),
  retain: vi.fn(async () => [{ organization: "Test", anonymized: 3 }]),
}));
vi.mock("@/server/services/reminders", () => ({ runDigestForAllOrgs: digest }));
vi.mock("@/server/services/retention", () => ({ runRetentionForAllOrgs: retain }));

import { GET, POST } from "@/app/api/cron/hr-digest/route";
import { GET as retentionGET, POST as retentionPOST } from "@/app/api/cron/data-retention/route";

const call = (handler: typeof GET, auth?: string, path = "hr-digest") =>
  handler(new Request(`http://localhost/api/cron/${path}`, { headers: auth ? { authorization: auth } : {} }));

afterEach(() => {
  delete process.env.CRON_SECRET;
  digest.mockClear();
  retain.mockClear();
});

describe("/api/cron/hr-digest", () => {
  it("is switched off when no CRON_SECRET is configured", async () => {
    const res = await call(GET, "Bearer anything");
    expect(res.status).toBe(503);
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or wrong secret", async () => {
    process.env.CRON_SECRET = "correct-horse-battery";
    expect((await call(GET)).status).toBe(401);
    expect((await call(GET, "correct-horse-battery")).status).toBe(401); // no "Bearer"
    expect((await call(GET, "Bearer wrong-secret-here")).status).toBe(401);
    expect((await call(GET, "Bearer correct-horse-batterz")).status).toBe(401); // same length, one character off
    expect(digest).not.toHaveBeenCalled();
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
    expect(digest).toHaveBeenCalledTimes(2);
  });
});

describe("/api/cron/data-retention", () => {
  it("is switched off without a secret and refuses a wrong one", async () => {
    expect((await call(retentionGET, "Bearer anything", "data-retention")).status).toBe(503);
    process.env.CRON_SECRET = "correct-horse-battery";
    expect((await call(retentionGET, undefined, "data-retention")).status).toBe(401);
    expect((await call(retentionPOST, "Bearer correct-horse-batterz", "data-retention")).status).toBe(401);
    expect(retain).not.toHaveBeenCalled();
  });

  it("runs the job for the right secret and reports what it removed", async () => {
    process.env.CRON_SECRET = "correct-horse-battery";
    const res = await call(retentionGET, "Bearer correct-horse-battery", "data-retention");
    expect(res.status).toBe(200);
    expect((await res.json()).results[0]).toMatchObject({ organization: "Test", anonymized: 3 });
    expect(retain).toHaveBeenCalledTimes(1);
    expect(digest).not.toHaveBeenCalled(); // each endpoint runs only its own job
  });
});
