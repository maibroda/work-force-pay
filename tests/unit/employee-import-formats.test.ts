import { describe, expect, it } from "vitest";
import { checkImport, decodeCsvBytes, detectDelimiter, importTemplateCsv, mapHeaders, parseCsv, type ExistingPerson } from "@/lib/employee-import";

/**
 * The review of the app (2026-11-04) found that a file saved from Excel was refused with "The file is missing required column(s): First Name, Last Name, Employment Date,
 * Category", although the columns were there: the importer read only UTF-8 text split by commas, so a file saved with semicolons (as Excel does in many regional settings),
 * with tabs, as UTF-16 ("Unicode Text") or as Windows ANSI read as one unrecognisable cell. These tests pin that every shape Excel produces is read the same as the template.
 */
const ref = {
  categories: [{ id: "c1", code: "GUARD", name: "Security Guard" }],
  departments: [] as { id: string; code: string; name: string }[],
  existing: [] as ExistingPerson[],
  today: "2026-10-24",
};
const bytes = (...n: number[]) => new Uint8Array(n);
const utf16le = (s: string, bom = true) => {
  const out: number[] = bom ? [0xff, 0xfe] : [];
  for (const ch of s) out.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
  return new Uint8Array(out);
};
const utf16be = (s: string) => {
  const out: number[] = [0xfe, 0xff];
  for (const ch of s) out.push(ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff);
  return new Uint8Array(out);
};
const GOOD_ROW = ["Chinedu", "", "Okafor", "", "", "", "", "", "", "01/02/2026", "GUARD"];

describe("decoding the bytes of the file", () => {
  it("reads plain UTF-8, and UTF-8 with a byte-order mark, as the same text", () => {
    expect(decodeCsvBytes(new TextEncoder().encode("First Name,Last Name\nA,B"))).toBe("First Name,Last Name\nA,B");
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("First Name,Last Name")]))).toBe("First Name,Last Name");
  });

  it("reads UTF-16 (Excel's \"Unicode Text\"), little- and big-endian, with its byte-order mark", () => {
    expect(decodeCsvBytes(utf16le("First Name\tLast Name\r\nA\tB"))).toBe("First Name\tLast Name\r\nA\tB");
    expect(decodeCsvBytes(utf16be("First Name\tLast Name\r\nA\tB"))).toBe("First Name\tLast Name\r\nA\tB");
  });

  it("reads Windows ANSI (Excel's plain \"CSV\" on Windows) when it is not valid UTF-8, so an accented name survives", () => {
    // "Chinedu Ọkafor" cannot be Windows-1252, so use a plain accented letter: "José"
    expect(decodeCsvBytes(bytes(0x4a, 0x6f, 0x73, 0xe9))).toBe("José");
  });

  it("gives an empty file as empty text", () => {
    expect(decodeCsvBytes(new Uint8Array())).toBe("");
  });
});

describe("the separator", () => {
  it("is found from the file: comma, semicolon or tab, whichever the first lines use", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("single column\nvalue")).toBe(","); // nothing to go on: the usual one
  });

  it("ignores separators inside quotes when deciding, and keeps them inside the field", () => {
    expect(detectDelimiter('"a, b";"c, d"\n1;2')).toBe(";");
    expect(parseCsv('First Name;Last Name\n"Ade, Jr";Bello')).toEqual([["First Name", "Last Name"], ["Ade, Jr", "Bello"]]);
    expect(parseCsv('a,b\n"x; y",z')).toEqual([["a", "b"], ["x; y", "z"]]); // a comma file that has a semicolon in a value stays a comma file
  });

  it("parses the same table whichever separator the file used", () => {
    const comma = parseCsv("First Name,Last Name\nA,B");
    expect(parseCsv("First Name;Last Name\nA;B")).toEqual(comma);
    expect(parseCsv("First Name\tLast Name\nA\tB")).toEqual(comma);
  });
});

describe("the whole template, saved the ways Excel saves it", () => {
  const template = importTemplateCsv();
  const asSemicolons = template.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ";");
  const asTabs = template.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "\t");

  it("is read cleanly whether separated by commas, semicolons or tabs (the first row has all the columns, none missing)", () => {
    for (const [name, text] of [["commas", template], ["semicolons", asSemicolons], ["tabs", asTabs]] as const) {
      const table = parseCsv(text);
      const h = mapHeaders(table[0]);
      expect(h.missingRequired, name).toEqual([]);
      expect(h.unknown, name).toEqual([]);
      expect(checkImport(text, ref).fatal, name).toBeNull();
    }
  });

  it("is read cleanly when saved as UTF-16 text and decoded from its bytes, and when it has a byte-order mark", () => {
    expect(checkImport(decodeCsvBytes(utf16le(asTabs)), ref).fatal).toBeNull();
    expect(checkImport(decodeCsvBytes(utf16be(asTabs)), ref).fatal).toBeNull();
    expect(checkImport("﻿" + asSemicolons, ref).fatal).toBeNull();
  });
});

describe("the header row", () => {
  const HEAD = "First Name,Middle Name,Last Name,Gender,Date of Birth,Phone,Email,State of Residence,Address,Employment Date,Category";
  const row = GOOD_ROW.join(",");

  it("is found even when a title or notes come first, and the line numbers still point at the right row in the file", () => {
    const withTitle = ["Staff list 2026", HEAD, row, "Amaka,,Obi,,,,,,,,GUARD"].join("\r\n"); // the second person has no employment date
    const check = checkImport(withTitle, ref);
    expect(check.fatal).toBeNull();
    expect(check.rows.map((r) => r.line)).toEqual([3, 4]);
    expect(check.rows[1].errors.join(" ")).toMatch(/Employment date is missing/);
  });

  it("is still the first row when it is, and the existing behaviour is unchanged", () => {
    const check = checkImport([HEAD, row].join("\r\n"), ref);
    expect(check.fatal).toBeNull();
    expect(check.rows[0].line).toBe(2);
  });

  it("says what it did find, and what else a missing column is called, when the columns really are missing", () => {
    const fatal = checkImport("Name,Joined\nA,B", ref).fatal ?? "";
    expect(fatal).toMatch(/missing required column\(s\): First Name, Last Name, Employment Date, Category\./);
    expect(fatal).toMatch(/I found: "Name", "Joined"/);
    expect(fatal).toMatch(/Employment Date \(also accepted: .*Date joined/);
  });

  it("accepts more of the names a hire date goes by", () => {
    for (const h of ["Date of Joining", "Hire Date", "Joining Date", "Date Hired"]) expect(mapHeaders(["First Name", "Last Name", h, "Category"]).missingRequired, h).toEqual([]);
  });
});
