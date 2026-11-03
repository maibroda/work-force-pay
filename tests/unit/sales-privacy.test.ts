import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, normalizeEmail, signUnsubscribe, suppressionHash, verifyUnsubscribe } from "@/lib/sales/privacy";

const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters-long";

describe("normalising and masking", () => {
  it("reduces an email to lower case without spaces, and refuses what is not an email", () => {
    expect(normalizeEmail("  Funmi.Bello@Lekki.TEST ")).toBe("funmi.bello@lekki.test");
    for (const bad of ["", "   ", "no-at-sign", null, undefined, "a@", "@b.c"]) expect(normalizeEmail(bad as never)).toBeNull();
  });

  it("masks an email to its first letter and its domain, and a phone number to its country code and last three digits", () => {
    expect(maskEmail("funmi@lekki.test")).toBe("f***@lekki.test");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    expect(maskEmail(null)).toBe("");
    expect(maskPhone("+2348031234567")).toBe("+234*******567");
    expect(maskPhone("+2348031234567")).toHaveLength("+2348031234567".length);
    expect(maskPhone(null)).toBe("");
    expect(maskPhone("12345")).toBe("*****"); // not a full number: nothing shown
  });
});

describe("the unsubscribe link", () => {
  const who = { orgId: "org_1", type: "CONTACT" as const, id: "contact_9" };

  it("is a signed token that gives back exactly who it was made for", () => {
    const t = signUnsubscribe(SECRET, who);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); // safe in a web address
    expect(verifyUnsubscribe(SECRET, t)).toEqual(who);
    expect(verifyUnsubscribe(SECRET, signUnsubscribe(SECRET, { orgId: "org_1", type: "LEAD", id: "lead_1" }))).toEqual({ orgId: "org_1", type: "LEAD", id: "lead_1" });
  });

  it("is the same every time for the same person, and different for another person or organization", () => {
    expect(signUnsubscribe(SECRET, who)).toBe(signUnsubscribe(SECRET, who));
    expect(signUnsubscribe(SECRET, who)).not.toBe(signUnsubscribe(SECRET, { ...who, id: "contact_10" }));
    expect(signUnsubscribe(SECRET, who)).not.toBe(signUnsubscribe(SECRET, { ...who, orgId: "org_2" }));
  });

  it("is refused when altered, made with another secret, cut short, or not a token at all", () => {
    const t = signUnsubscribe(SECRET, who);
    const [payload, mac] = t.split(".");
    const forged = signUnsubscribe(SECRET, { ...who, id: "contact_10" }).split(".")[0];
    for (const bad of [`${forged}.${mac}`, `${payload}.${mac.slice(0, -1)}A`, `${payload}.`, `.${mac}`, payload, "", "not a token", `${payload}.${mac}.extra`, "a".repeat(5000)]) expect(verifyUnsubscribe(SECRET, bad), bad.slice(0, 30)).toBeNull();
    expect(verifyUnsubscribe("another-secret-that-is-also-thirty-two-chars-long", t)).toBeNull();
  });

  it("refuses to be made with a weak secret", () => {
    expect(() => signUnsubscribe("short", who)).toThrow(/secret/i);
    expect(() => suppressionHash("short", "org_1", "EMAIL", "a@b.co")).toThrow(/secret/i);
  });
});

describe("the suppression hash", () => {
  it("is a keyed hash: the same for the same address in the same organization, never the address itself, different for another organization, kind or secret", () => {
    const h = suppressionHash(SECRET, "org_1", "EMAIL", "funmi@lekki.test");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("funmi");
    expect(suppressionHash(SECRET, "org_1", "EMAIL", "funmi@lekki.test")).toBe(h);
    expect(suppressionHash(SECRET, "org_2", "EMAIL", "funmi@lekki.test")).not.toBe(h);
    expect(suppressionHash(SECRET, "org_1", "PHONE", "funmi@lekki.test")).not.toBe(h);
    expect(suppressionHash("another-secret-that-is-also-thirty-two-chars-long", "org_1", "EMAIL", "funmi@lekki.test")).not.toBe(h);
  });
});
