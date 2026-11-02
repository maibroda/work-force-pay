import { describe, expect, it } from "vitest";
import { accountMatches, businessEmailDomain, personMatches } from "@/lib/sales/duplicates";
import { normalizeCompanyName } from "@/lib/sales/names";

const acct = (id: string, name: string, extra: { rcNumber?: string; emailDomain?: string } = {}) => ({ id, name, normalizedName: normalizeCompanyName(name), ...extra });

describe("finding the same company twice", () => {
  const existing = [acct("a1", "ABC Security Ltd", { rcNumber: "RC123456", emailDomain: "abcsecurity.com" }), acct("a2", "Ikoyi Towers")];
  it("matches the same company written differently, with the reason", () => {
    for (const name of ["A.B.C. Security Limited", "abc security", "ABC SECURITY PLC"]) expect(accountMatches({ name }, existing), name).toEqual([{ id: "a1", reason: "Same company name" }]);
  });
  it("matches on the RC number or the company's own email domain, and says which", () => {
    expect(accountMatches({ name: "Something Else", rcNumber: "rc123456" }, existing)).toEqual([{ id: "a1", reason: "Same RC number" }]);
    expect(accountMatches({ name: "Something Else", emailDomain: "AbcSecurity.com" }, existing)).toEqual([{ id: "a1", reason: "Same email domain (abcsecurity.com)" }]);
  });
  it("lists every reason once per match and never matches different companies", () => {
    const r = accountMatches({ name: "ABC Security", rcNumber: "RC123456" }, existing);
    expect(r).toEqual([{ id: "a1", reason: "Same company name, same RC number" }]);
    expect(accountMatches({ name: "Lekki Towers" }, existing)).toEqual([]);
  });
  it("ignores free-mail domains, which many unrelated people share", () => {
    expect(businessEmailDomain("ngozi@gmail.com")).toBeNull();
    expect(businessEmailDomain("a@Yahoo.com")).toBeNull();
    expect(businessEmailDomain("Ngozi@LekkiGardens.test")).toBe("lekkigardens.test");
    expect(businessEmailDomain("not an email")).toBeNull();
    const gmail = [acct("g1", "Gmail Co", { emailDomain: "gmail.com" })];
    expect(accountMatches({ name: "Other Co", emailDomain: "gmail.com" }, gmail)).toEqual([]);
  });
});

describe("finding the same person twice", () => {
  const people = [{ id: "p1", phoneE164: "+2348031234567", email: "ngozi@lekkigardens.test" }, { id: "p2", phoneE164: "+2347061234567", email: null }];
  it("matches the same phone or the same email (any case), with the reason", () => {
    expect(personMatches({ phoneE164: "+2348031234567" }, people)).toEqual([{ id: "p1", reason: "Same phone number" }]);
    expect(personMatches({ email: "NGOZI@LekkiGardens.test" }, people)).toEqual([{ id: "p1", reason: "Same email address" }]);
    expect(personMatches({ phoneE164: "+2348031234567", email: "ngozi@lekkigardens.test" }, people)).toEqual([{ id: "p1", reason: "Same phone number, same email address" }]);
  });
  it("matches nothing when nothing is given or nothing is shared", () => {
    expect(personMatches({}, people)).toEqual([]);
    expect(personMatches({ phoneE164: "+2349011111111", email: "x@y.test" }, people)).toEqual([]);
    expect(personMatches({ email: "" }, [{ id: "p3", phoneE164: null, email: null }])).toEqual([]);
  });
});
