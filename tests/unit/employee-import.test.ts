import { describe, expect, it } from "vitest";
import { checkImport, csvField, importTemplateCsv, mapHeaders, normalizePhone, parseCsv, parseDate, type ExistingPerson } from "@/lib/employee-import";

const ref = {
  categories: [{ id: "c1", code: "GUARD", name: "Security Guard" }, { id: "c2", code: "OFF", name: "Office Staff" }],
  departments: [{ id: "d1", code: "OPS", name: "Operations" }],
  existing: [] as ExistingPerson[],
  today: "2026-10-24",
};
const HEAD = "First Name,Last Name,Employment Date,Category,Gender,Date of Birth,Bank Name,Account Number,Account Name,Tax ID,Pension PIN,PFA,Phone";
const good = (over: Partial<Record<string, string>> = {}) => {
  const v = { fn: "Chinedu", ln: "Okafor", ed: "01/02/2026", cat: "GUARD", g: "Male", dob: "14/03/1990", bank: "GTBank", acct: "0123456789", an: "CHINEDU OKAFOR", tax: "TIN1", pin: "PEN1", pfa: "Stanbic", ph: "08031234567", ...over };
  return [v.fn, v.ln, v.ed, v.cat, v.g, v.dob, v.bank, v.acct, v.an, v.tax, v.pin, v.pfa, v.ph].join(",");
};
const run = (...rows: string[]) => checkImport([HEAD, ...rows].join("\r\n"), ref);

describe("csv parsing", () => {
  it("handles quotes, doubled quotes, commas and line breaks in fields, CRLF and a byte-order mark", () => {
    const t = '﻿a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",z\r\n';
    expect(parseCsv(t)).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", "z"]]);
  });
  it("keeps empty fields and skips blank lines", () => {
    expect(parseCsv("a,b,c\n1,,3\n\n4,5,\n")).toEqual([["a", "b", "c"], ["1", "", "3"], ["4", "5", ""]]);
  });
  it("writes fields back safely", () => {
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("plain")).toBe("plain");
  });
});

describe("headers", () => {
  it("recognises headers ignoring case, spacing and common aliases, and reports the rest", () => {
    const h = mapHeaders(["FIRST NAME", "surname", "Date Joined", "Employee Category", "Favourite colour", "first name"]);
    expect(h.byIndex).toEqual(["firstName", "lastName", "employmentDate", "category", null, null]);
    expect(h.unknown).toEqual(["Favourite colour", "first name (repeated)"]);
    expect(h.missingRequired).toEqual([]);
  });
  it("lists missing required columns", () => {
    expect(mapHeaders(["First Name", "Surname"]).missingRequired).toEqual(["Employment Date", "Category"]);
  });
  it("the template has every column and parses back cleanly", () => {
    const t = parseCsv(importTemplateCsv());
    expect(t).toHaveLength(2);
    expect(mapHeaders(t[0]).missingRequired).toEqual([]);
    expect(mapHeaders(t[0]).unknown).toEqual([]);
  });
});

describe("values", () => {
  it("reads day-first and ISO dates and rejects impossible ones", () => {
    expect(parseDate("31/12/1990")).toBe("1990-12-31");
    expect(parseDate("1-2-2026")).toBe("2026-02-01");
    expect(parseDate("1990-12-31")).toBe("1990-12-31");
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("tomorrow")).toBeNull();
  });
  it("treats +234 and 0 numbers as the same phone", () => {
    expect(normalizePhone("+234 803 123 4567")).toBe("08031234567");
    expect(normalizePhone("0803-123-4567")).toBe("08031234567");
  });
});

describe("checking a file", () => {
  it("accepts a good row cleanly and prepares it for the employee service", () => {
    const c = run(good());
    expect(c.summary).toEqual({ total: 1, ok: 1, warnings: 0, errors: 0 });
    expect(c.rows[0].employee).toMatchObject({ firstName: "Chinedu", gender: "MALE", dateOfBirth: "1990-03-14", employmentDate: "2026-02-01", categoryId: "c1", accountNumber: "0123456789" });
  });

  it("matches category by code or by name, ignoring case", () => {
    expect(run(good({ cat: "security guard" })).rows[0].employee?.categoryId).toBe("c1");
    expect(run(good({ cat: "off" })).rows[0].employee?.categoryId).toBe("c2");
    const bad = run(good({ cat: "Pilot" })).rows[0];
    expect(bad.errors[0]).toMatch(/Category "Pilot" is not one of: GUARD, OFF/);
    expect(bad.employee).toBeUndefined();
  });

  it("reports each problem with the row's line number and never prepares a row with an error", () => {
    const c = run(good(), good({ fn: "", acct: "12345", ed: "31/02/2026", g: "X" }));
    const r = c.rows[1];
    expect(r.line).toBe(3);
    expect(r.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/First name is missing/), expect.stringMatching(/must be 10 digits/), expect.stringMatching(/not a date/), expect.stringMatching(/not Male or Female/)]),
    );
    expect(r.employee).toBeUndefined();
    expect(c.summary.errors).toBe(1);
  });

  it("warns, without blocking, about missing bank, pension and tax details", () => {
    const r = run(good({ bank: "", acct: "", an: "", tax: "", pin: "" })).rows[0];
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/No bank details/), expect.stringMatching(/Tax ID is missing/), expect.stringMatching(/Pension PIN or PFA/)]));
    expect(r.employee).toBeDefined();
  });

  it("catches duplicate account numbers, tax IDs, pension PINs and names within the file", () => {
    const c = run(good(), good({ fn: "Ada", dob: "01/01/1991", ph: "08099999999" }));
    const r = c.rows[1];
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Account number also appears on line 2/), expect.stringMatching(/Tax ID also appears on line 2/), expect.stringMatching(/Pension PIN also appears on line 2/)]));
    const same = run(good(), good({ acct: "9999999999", tax: "T2", pin: "P2", ph: "08098765432" }));
    expect(same.rows[1].errors).toEqual([expect.stringMatching(/same name and date of birth also appears on line 2|name and date of birth/)]);
  });

  it("warns, rather than blocks, on a phone number shared with someone else", () => {
    const c = run(good(), good({ fn: "Ada", dob: "01/01/1991", acct: "1111111111", tax: "T2", pin: "P2", ph: "+234 803 123 4567" }));
    expect(c.rows[1].errors).toEqual([]);
    expect(c.rows[1].warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Phone number also appears on line 2/)]));
  });

  it("catches duplicates against people already on the books", () => {
    const existing: ExistingPerson[] = [{ employeeNumber: "EMP-000007", firstName: "Chinedu", lastName: "Okafor", accountNumber: "0123456789", taxId: "TIN1", pensionPin: null, phone: "08031234567", dateOfBirth: "1990-03-14" }];
    const c = checkImport([HEAD, good()].join("\n"), { ...ref, existing });
    expect(c.rows[0].errors).toEqual(expect.arrayContaining([expect.stringMatching(/Account number is already held by EMP-000007/), expect.stringMatching(/Tax ID is already held by EMP-000007/)]));
  });

  it("rejects a file with missing required columns, no rows, or too many rows", () => {
    expect(checkImport("First Name,Surname\nA,B", ref).fatal).toMatch(/missing required column\(s\): Employment Date, Category/);
    expect(checkImport(HEAD, ref).fatal).toMatch(/no rows/);
    const many = [HEAD, ...Array.from({ length: 1001 }, (_, i) => good({ acct: String(1000000000 + i), tax: `T${i}`, pin: `P${i}`, fn: `N${i}` }))].join("\n");
    expect(checkImport(many, ref).fatal).toMatch(/limit is 1000/);
  });

  it("flags implausible ages and a start date before birth", () => {
    expect(run(good({ dob: "01/01/2015" })).rows[0].warnings.join(" ")).toMatch(/years old/);
    expect(run(good({ dob: "01/01/2030" })).rows[0].errors.join(" ")).toMatch(/in the future/);
    expect(run(good({ dob: "01/01/2027" })).rows[0].errors.join(" ")).toMatch(/in the future/);
    expect(run(good({ dob: "01/01/1990", ed: "01/01/1980" })).rows[0].errors.join(" ")).toMatch(/before the date of birth/);
  });
});

describe("the voluntary NHF column", () => {
  const withNhf = (value: string) => checkImport([HEAD + ",NHF Contribution", good() + "," + value].join("\r\n"), ref).rows[0];
  it("starts the contribution only for a clear Yes, and leaves everyone else as not contributing", () => {
    for (const yes of ["Yes", "yes", "Y", "true"]) expect(withNhf(yes).employee?.nhfContributes, yes).toBe(true);
    for (const no of ["No", "no", "", "false"]) {
      expect(withNhf(no).employee?.nhfContributes, no).toBeUndefined();
      expect(withNhf(no).warnings.join(" ")).not.toMatch(/NHF/);
    }
  });
  it("warns, and does not start it, when the cell is neither Yes nor No (it is voluntary: only Yes starts it)", () => {
    const r = withNhf("maybe");
    expect(r.employee?.nhfContributes).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/NHF contribution "maybe" is not Yes or No/);
  });
  it("is not required: a file without the column imports as before", () => {
    expect(run(good()).rows[0].employee?.nhfContributes).toBeUndefined();
  });
});
