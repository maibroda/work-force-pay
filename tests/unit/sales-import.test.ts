import { describe, expect, it } from "vitest";
import { checkImport, errorsCsv, importTemplateCsv, mapHeaders, matchChoice, MAX_IMPORT_ROWS, safeCell, SOURCES } from "@/lib/sales/import";

const LEAD_HEAD = "Company,Contact Person,Phone,Email,State,Source,Service Wanted,Estimated Guards,Marketing Consent,Consent Source";

describe("reading the headers", () => {
  it("recognises headers in any case, spacing and common alias, and reports the rest", () => {
    const h = mapHeaders("LEADS", ["COMPANY NAME", "contact", "Mobile", "e-mail", "Favourite colour", "company"]);
    expect(h.byIndex).toEqual(["companyName", "contactName", "phone", "email", null, null]);
    expect(h.unknown).toEqual(["Favourite colour", "company (repeated)"]);
    expect(h.missingRequired).toEqual([]);
  });
  it("lists the required columns that are missing, for each kind", () => {
    expect(mapHeaders("LEADS", ["Phone"]).missingRequired).toEqual(["Company"]);
    expect(mapHeaders("CONTACTS", ["First Name"]).missingRequired).toEqual(["Last Name"]);
    expect(mapHeaders("ACCOUNTS", ["Industry"]).missingRequired).toEqual(["Company"]);
  });
  it("the template of every kind has its own columns and reads back cleanly", () => {
    for (const k of ["LEADS", "ACCOUNTS", "CONTACTS"] as const) {
      const c = checkImport(k, importTemplateCsv(k));
      expect(c.fatal, k).toBeUndefined();
      expect(c.headers?.unknown, k).toEqual([]);
      expect(c.summary.errors, k).toBe(0);
    }
  });
});

describe("checking lead rows", () => {
  const run = (...rows: string[]) => checkImport("LEADS", [LEAD_HEAD, ...rows].join("\r\n"));
  it("accepts a good row and prepares it: phone in +234 form, email in lower case, choices matched by name", () => {
    const c = run("Lekki Gardens Estate,Ngozi Okoro,0803 123 4567,Ngozi@LekkiGardens.test,Lagos,walk in,Guarding,18,Yes,Web form 12 Oct");
    expect(c.summary).toEqual({ total: 1, ok: 1, warnings: 0, errors: 0 });
    expect(c.rows[0].data).toEqual({ companyName: "Lekki Gardens Estate", contactName: "Ngozi Okoro", state: "Lagos", phoneE164: "+2348031234567", email: "ngozi@lekkigardens.test", source: "WALK_IN", serviceInterest: "GUARDING", estimatedGuards: 18, consent: { status: "GRANTED", source: "Web form 12 Oct" } });
  });
  it("says what is wrong with each row, by line number, and prepares nothing for it", () => {
    const c = run(",,12345,not-an-email,,Skywriting,Magic,-3,Maybe,", "Fine Co,,,,,,,,,");
    expect(c.rows[0].line).toBe(2);
    expect(c.rows[0].errors).toEqual(expect.arrayContaining([expect.stringMatching(/Company is missing/), expect.stringMatching(/Phone/), expect.stringMatching(/Email "not-an-email"/), expect.stringMatching(/Source "Skywriting"/), expect.stringMatching(/Service wanted "Magic"/), expect.stringMatching(/Estimated guards "-3"/), expect.stringMatching(/Marketing consent "Maybe"/)]));
    expect(c.rows[0].data).toBeUndefined();
    expect(c.rows[1].errors).toEqual([]);
    expect(c.summary).toMatchObject({ total: 2, errors: 1, ok: 1 });
  });
  it("records consent only when the file says where it came from", () => {
    expect(run("A Co,,,,,,,,Yes,").rows[0].errors.join(" ")).toMatch(/needs a Consent Source/);
    expect(run("B Co,,,,,,,,Yes,ok").rows[0].errors.join(" ")).toMatch(/needs a Consent Source/); // too short to be a source
    expect(run("C Co,,,,,,,,No,Called and said stop").rows[0].data?.consent).toEqual({ status: "WITHDRAWN", source: "Called and said stop" });
    expect(run("D Co,,,,,,,,,Web form").rows[0]).toMatchObject({ errors: [], warnings: [expect.stringMatching(/no consent is recorded/)] });
    expect(run("E Co,,,,,,,,,").rows[0].data?.consent).toBeUndefined(); // empty means unknown
  });
  it("warns about the same company, phone or email twice in the file", () => {
    const c = run("Same Co Ltd,,0803 123 4567,a@x.test,,,,,,", "SAME CO LIMITED,,+234 803 123 4567,a@x.test,,,,,,");
    expect(c.rows[1].warnings).toEqual(expect.arrayContaining([expect.stringMatching(/company also appears on line 2/i), expect.stringMatching(/phone number also appears on line 2/i), expect.stringMatching(/email address also appears on line 2/i)]));
    expect(c.rows[1].errors).toEqual([]);
  });
});

describe("contacts and accounts", () => {
  it("needs both names for a contact, reads the decision role and WhatsApp number", () => {
    const c = checkImport("CONTACTS", "First Name,Last Name,Role In Decision,WhatsApp\r\nNgozi,,Decision maker,0803 123 4567\r\nAda,Obi,decision maker,0803 123 4567");
    expect(c.rows[0].errors).toEqual([expect.stringMatching(/Last name is missing/)]);
    expect(c.rows[1].data).toMatchObject({ roleInDecision: "DECISION_MAKER", whatsappE164: "+2348031234567" });
  });
  it("reads an account's type and company email domain", () => {
    const c = checkImport("ACCOUNTS", "Company,Type,Email Domain\r\nAcme Ltd,Former client,@Acme.com\r\nBeta Co,Customer,");
    expect(c.rows[0].data).toMatchObject({ accountType: "FORMER_CLIENT", emailDomain: "acme.com" });
    expect(c.rows[1].errors).toEqual([expect.stringMatching(/Type "Customer"/)]);
  });
});

describe("whole-file limits and safe output", () => {
  it("refuses an empty file, a file with no rows, missing required columns and too many rows", () => {
    expect(checkImport("LEADS", "").fatal).toMatch(/empty/);
    expect(checkImport("LEADS", LEAD_HEAD).fatal).toMatch(/no rows/);
    expect(checkImport("LEADS", "Phone\r\n0803").fatal).toMatch(/missing required column\(s\): Company/);
    const many = [LEAD_HEAD, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Co ${i},,,,,,,,,`)].join("\n");
    expect(checkImport("LEADS", many).fatal).toMatch(/limit is 1000/);
  });
  it("matches a choice by name however it is written", () => {
    expect(matchChoice("Walk-in", SOURCES)).toBe("WALK_IN");
    expect(matchChoice(" existing client ", SOURCES)).toBe("EXISTING_CLIENT");
    expect(matchChoice("Carrier pigeon", SOURCES)).toBeNull();
  });
  it("makes a cell a spreadsheet would run as a formula harmless, but leaves a plain +234 number alone", () => {
    expect(safeCell("=HYPERLINK(\"http://evil.test\")")).toBe("'=HYPERLINK(\"http://evil.test\")");
    expect(safeCell("+cmd|' /C calc'!A0")).toMatch(/^'\+cmd/);
    expect(safeCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(safeCell("-5+3")).toBe("'-5+3");
    expect(safeCell("+2348031234567")).toBe("+2348031234567");
    expect(safeCell("Lekki Gardens")).toBe("Lekki Gardens");
    expect(safeCell(null)).toBe("");
  });
  it("writes the rows with errors back out with what was wrong, ready to correct and upload again", () => {
    const c = checkImport("LEADS", [LEAD_HEAD, ",,12345,,,,,,,", "Fine Co,,,,,,,,,"].join("\r\n"));
    const out = errorsCsv("LEADS", c).split("\r\n");
    expect(out[0]).toMatch(/^Company,.*,Problems$/);
    expect(out).toHaveLength(3); // header, one failed row, trailing empty
    expect(out[1]).toMatch(/Company is missing/);
    expect(out[1]).not.toMatch(/Fine Co/);
  });
});
