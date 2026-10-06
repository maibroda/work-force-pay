import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubDeep, scrubText } from "@/lib/pii-scrub";
import { scrubBeforeSend } from "@/lib/sentry-scrub";

describe("scrubText", () => {
  it("removes email addresses", () => {
    expect(scrubText("No user found for ada.okafor@example.com today")).toBe("No user found for [email] today");
  });

  it("removes Nigerian phone numbers in the usual spellings", () => {
    for (const p of ["08031234567", "0803 123 4567", "0803-123-4567", "+2348031234567", "+234 803 123 4567", "2348031234567"])
      expect(scrubText(`call ${p} now`), p).toBe("call [phone] now");
  });

  it("removes bank account, NIN and BVN-length numbers but leaves short numbers alone", () => {
    expect(scrubText("account 0123456789 failed")).toBe("account [number] failed");
    expect(scrubText("NIN 70000000045")).toBe("NIN [number]");
    expect(scrubText("row 42 of 1500 failed after 3 retries")).toBe("row 42 of 1500 failed after 3 retries");
    expect(scrubText("amount 125000.50 invalid")).toBe("amount 125000.50 invalid");
  });

  it("removes bearer tokens, JWTs and secrets in query strings", () => {
    expect(scrubText("Authorization: Bearer abcDEF123456789xyz")).toBe("Authorization: Bearer [token]");
    expect(scrubText("fetch /reset-password?token=s3cr3t-value&x=1")).toBe("fetch /reset-password?token=[removed]&x=1");
    expect(scrubText("session eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.abcdefghij1234")).toBe("session [token]");
  });

  it("leaves ordinary error text and stack frames alone", () => {
    const t = "TypeError: Cannot read properties of undefined (reading 'name') at src/server/services/payroll.ts:482:17";
    expect(scrubText(t)).toBe(t);
  });
});

describe("scrubDeep", () => {
  it("cleans strings at any depth and leaves other values as they are", () => {
    const out = scrubDeep({ a: "mail me@x.org", n: 5, ok: true, nested: { list: ["0123456789", { deep: "+2348031234567" }] }, d: null });
    expect(out).toEqual({ a: "mail [email]", n: 5, ok: true, nested: { list: ["[number]", { deep: "[phone]" }] }, d: null });
  });
});

describe("scrubBeforeSend", () => {
  it("drops cookies, bodies and identity, and cleans messages, stack text, breadcrumbs and extras", () => {
    const event = {
      message: "Bank file rejected for 0123456789",
      request: { url: "https://app.example/reset?token=abc", cookies: { wp_session: "x" }, data: { password: "p" }, query_string: "token=abc", headers: { cookie: "wp_session=x", authorization: "Bearer y", "x-forwarded-for": "1.2.3.4", accept: "text/html" } },
      user: { id: "u1", email: "ada@example.com", ip_address: "1.2.3.4" },
      exception: { values: [{ type: "Error", value: "User ada@example.com not found" }] },
      breadcrumbs: [{ message: "looked up 08031234567", data: { who: "ada@example.com" } }],
      extra: { note: "acct 0123456789" },
    } as unknown as ErrorEvent;
    const out = scrubBeforeSend(event);
    expect(out.message).toBe("Bank file rejected for [number]");
    expect(out.request).toEqual({ url: "https://app.example/reset", headers: { accept: "text/html" } });
    expect(out.user).toEqual({ id: "u1" });
    expect(out.exception?.values?.[0].value).toBe("User [email] not found");
    expect(out.breadcrumbs?.[0]).toEqual({ message: "looked up [phone]", data: { who: "[email]" } });
    expect(out.extra).toEqual({ note: "acct [number]" });
  });
});
