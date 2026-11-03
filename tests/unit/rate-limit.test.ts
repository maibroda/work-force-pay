import { describe, expect, it } from "vitest";
import { clientIp, createLimiter, limitKey } from "@/lib/rate-limit";

describe("the rate limiter", () => {
  it("lets the first `limit` calls in a window through, refuses the next, and says how long to wait", () => {
    const l = createLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(l.check("a", t0)).toMatchObject({ ok: true, remaining: 2 });
    expect(l.check("a", t0 + 1_000)).toMatchObject({ ok: true, remaining: 1 });
    expect(l.check("a", t0 + 2_000)).toMatchObject({ ok: true, remaining: 0 });
    const refused = l.check("a", t0 + 3_000);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSeconds).toBe(57); // the first call leaves the window 60 s after it was made, and 3 s have passed
  });

  it("is a sliding window: capacity returns as old calls age out, not all at once at a fixed boundary", () => {
    const l = createLimiter({ limit: 2, windowMs: 10_000 });
    l.check("a", 0);
    l.check("a", 6_000);
    expect(l.check("a", 9_000).ok).toBe(false);
    expect(l.check("a", 10_001).ok).toBe(true); // the call at 0 has left, the call at 6 000 has not
    expect(l.check("a", 10_002).ok).toBe(false);
  });

  it("counts each key on its own", () => {
    const l = createLimiter({ limit: 1, windowMs: 60_000 });
    expect(l.check("a", 0).ok).toBe(true);
    expect(l.check("a", 1).ok).toBe(false);
    expect(l.check("b", 2).ok).toBe(true);
  });

  it("does not count a refused call against the caller, so waiting the stated time is always enough", () => {
    const l = createLimiter({ limit: 1, windowMs: 10_000 });
    l.check("a", 0);
    for (let i = 1; i < 50; i++) l.check("a", i * 100); // hammering while refused
    expect(l.check("a", 10_001).ok).toBe(true);
  });

  it("forgets keys that have gone quiet and never holds more than maxKeys, so it cannot be used to fill memory", () => {
    const l = createLimiter({ limit: 5, windowMs: 1_000, maxKeys: 100 });
    for (let i = 0; i < 1_000; i++) l.check(`k${i}`, 0);
    expect(l.size()).toBeLessThanOrEqual(100);
    l.check("late", 5_000);
    expect(l.size()).toBeLessThanOrEqual(100);
    const small = createLimiter({ limit: 5, windowMs: 1_000 });
    small.check("x", 0);
    small.check("y", 5_000); // x has expired and is dropped
    expect(small.size()).toBe(1);
  });

  it("can be reset (for tests)", () => {
    const l = createLimiter({ limit: 1, windowMs: 60_000 });
    l.check("a", 0);
    l.reset();
    expect(l.check("a", 1).ok).toBe(true);
  });
});

describe("who a request is from (F-05)", () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it("trusts no forwarding header unless the company says it sits behind a proxy, because anyone can send one", () => {
    const spoof = h({ "x-forwarded-for": "41.58.1.2", "x-real-ip": "41.58.1.9", "cf-connecting-ip": "41.58.1.7" });
    expect(clientIp(spoof, {})).toBe("unknown");
    expect(clientIp(spoof, { TRUSTED_PROXY_HOPS: "0" })).toBe("unknown");
    expect(clientIp(spoof, { TRUSTED_PROXY_HOPS: "" })).toBe("unknown");
  });

  it("with n trusted proxies, takes the n-th address from the RIGHT of x-forwarded-for, the one the nearest trusted proxy saw; what a visitor put on the left cannot be chosen", () => {
    const chain = h({ "x-forwarded-for": "6.6.6.6, 41.58.1.2, 10.0.0.1" }); // 6.6.6.6 was typed by the visitor
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: "1" })).toBe("10.0.0.1");
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: "2" })).toBe("41.58.1.2");
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: "3" })).toBe("6.6.6.6");
    expect(clientIp(chain, { TRUSTED_PROXY_HOPS: "4" })).toBe("unknown"); // more proxies claimed than the header has
    expect(clientIp(h({ "x-forwarded-for": " 41.58.1.2 " }), { TRUSTED_PROXY_HOPS: "1" })).toBe("41.58.1.2");
    expect(clientIp(h({}), { TRUSTED_PROXY_HOPS: "1" })).toBe("unknown");
  });

  it("can instead take a single header the proxy sets (Cloudflare's, or x-real-ip), and that header wins", () => {
    const both = h({ "cf-connecting-ip": "41.58.1.7", "x-forwarded-for": "6.6.6.6, 10.0.0.1" });
    expect(clientIp(both, { TRUSTED_IP_HEADER: "cf-connecting-ip" })).toBe("41.58.1.7");
    expect(clientIp(both, { TRUSTED_IP_HEADER: "CF-Connecting-IP", TRUSTED_PROXY_HOPS: "1" })).toBe("41.58.1.7");
    expect(clientIp(h({ "x-real-ip": "41.58.1.9" }), { TRUSTED_IP_HEADER: "x-real-ip" })).toBe("41.58.1.9");
    expect(clientIp(h({}), { TRUSTED_IP_HEADER: "x-real-ip" })).toBe("unknown");
  });

  it("never returns something long or odd, so a hostile header cannot be used to make keys", () => {
    const env = { TRUSTED_PROXY_HOPS: "1" };
    expect(clientIp(h({ "x-forwarded-for": "x".repeat(500) }), env)).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "not an address!" }), env)).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "2001:db8::1" }), env)).toBe("2001:db8::1");
    expect(clientIp(h({ "x-forwarded-for": "41.58.1.2" }), { TRUSTED_PROXY_HOPS: "x" })).toBe("unknown"); // a typo in the setting trusts nothing
    expect(clientIp(h({ "x-forwarded-for": "41.58.1.2" }), { TRUSTED_PROXY_HOPS: "-1" })).toBe("unknown");
  });
});

describe("the key a visitor is counted under", () => {
  it("is their address when it is known", () => {
    expect(limitKey("41.58.1.2", "abc.def")).toBe("41.58.1.2");
  });
  it("is their own link when it is not, so a visitor with no usable address does not use up the allowance of everyone else", () => {
    const a = limitKey("unknown", "payloadAAAAAAAAAAAAAAAA.sigA");
    const b = limitKey("unknown", "payloadBBBBBBBBBBBBBBBB.sigB");
    expect(a).not.toBe(b);
    expect(a.startsWith("unknown:")).toBe(true);
    expect(limitKey("unknown", "payloadAAAAAAAAAAAAAAAA.sigA")).toBe(a); // the same link is the same key
    expect(limitKey("unknown", "x".repeat(5000)).length).toBeLessThan(60); // a hostile link cannot make a huge key
  });
});
