import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_CODE_LISTS } from "@/lib/bank-code-lists";
import {
  addKnownAliases,
  FIRST_BANK_LAYOUT,
  GENERIC_LAYOUT,
  layoutCells,
  layoutToText,
  parseCodeList,
  parseLayoutText,
  resolveInList,
  validateLayout,
  type ParsedCode,
} from "@/lib/paying-bank";

/**
 * A paying bank is data: its own list of bank codes (a bank's codes are valid only on its OWN list) and a file layout. These tests prove the rules with small invented
 * lists and with the founder's two real ones (Access Bank, First Bank). No account number here is real.
 */
const csv = (...rows: string[]) => ["bank_name,bank_code", ...rows].join("\n");

describe("reading a bank's code list", () => {
  it("keeps good entries, ignores blank lines and the header, and understands quoted names", () => {
    const r = parseCodeList(csv('GTBANK PLC,058', "", '"AL-BARAKAH, MFB",A11', "ZENITH BANK,057"));
    expect(r.entries.map((e) => [e.name, e.code, e.blocked])).toEqual([["GTBANK PLC", "058", false], ["AL-BARAKAH, MFB", "A11", false], ["ZENITH BANK", "057", false]]);
    expect(r.problems).toEqual([]);
  });

  it("merges an exact repeat (same bank, same code) into one entry without blocking it", () => {
    const r = parseCodeList(csv("ZENITH BANK,057", "ZENITH BANK,057"));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].blocked).toBe(false);
  });

  it("blocks a test bank, and a code with anything but letters and digits in it", () => {
    const r = parseCodeList(csv("NIBSS TEST BANK,039_", "REAL BANK,057", "SOME TEST BANK,999"));
    const by = Object.fromEntries(r.entries.map((e) => [e.name, e]));
    expect(by["NIBSS TEST BANK"]).toMatchObject({ blocked: true });
    expect(by["NIBSS TEST BANK"].reason).toMatch(/test/i);
    expect(by["SOME TEST BANK"].blocked).toBe(true);
    expect(by["REAL BANK"].blocked).toBe(false);
  });

  it("blocks EVERY bank that shares a code with another bank, naming the other", () => {
    const r = parseCodeList(csv("BLOOMS MFB,A43", "CORESTEP MICROFINANCE BANK,A43", "OTHER MFB,B10"));
    const by = Object.fromEntries(r.entries.map((e) => [e.name, e]));
    expect(by["BLOOMS MFB"].blocked).toBe(true);
    expect(by["BLOOMS MFB"].reason).toMatch(/CORESTEP MICROFINANCE BANK/);
    expect(by["CORESTEP MICROFINANCE BANK"].blocked).toBe(true);
    expect(by["OTHER MFB"].blocked).toBe(false);
  });

  it("blocks a bank listed under two different codes (it cannot be known which is right)", () => {
    const r = parseCodeList(csv("BLOOMS MFB,A43", "BLOOMS MFB,B44"));
    expect(r.entries.every((e) => e.blocked)).toBe(true);
    expect(r.entries[0].reason).toMatch(/more than one code/i);
  });

  it("blocks a code of fewer than 3 characters (a lost leading zero is not guessed at)", () => {
    const r = parseCodeList(csv("BOLDMFB,95", "OK BANK,095"));
    expect(r.entries.find((e) => e.code === "95")).toMatchObject({ blocked: true });
    expect(r.entries.find((e) => e.code === "95")!.reason).toMatch(/leading zero/i);
    expect(r.entries.find((e) => e.code === "095")!.blocked).toBe(false);
  });

  it("reports a row it cannot read, and does not make an entry of it", () => {
    const r = parseCodeList(csv("NO CODE HERE,", ",123", "FINE BANK,044"));
    expect(r.entries.map((e) => e.name)).toEqual(["FINE BANK"]);
    expect(r.problems).toHaveLength(2);
  });
});

describe("the founder's two real code lists", () => {
  const access = parseCodeList(BUILT_IN_CODE_LISTS.ACCESS_BANK.csv);
  const first = parseCodeList(BUILT_IN_CODE_LISTS.FIRST_BANK.csv);

  it("are loaded in full: Access has 471 rows and First Bank 651 (an exact repeat is merged)", () => {
    expect(access.entries.length + access.mergedRepeats).toBe(471);
    expect(first.entries.length + first.mergedRepeats).toBe(651);
  });

  it("have the built-in copy identical to the files in docs/bank-codes", () => {
    for (const [key, file] of [["ACCESS_BANK", "access-bank.csv"], ["FIRST_BANK", "first-bank.csv"]] as const)
      expect(BUILT_IN_CODE_LISTS[key].csv.replace(/\r\n/g, "\n")).toBe(readFileSync(path.join(__dirname, "../../docs/bank-codes", file), "utf8").replace(/\r\n/g, "\n"));
  });

  it("block exactly the entries that could send money to the wrong place, each for a stated reason", () => {
    const blocked = (l: ParsedCode[]) => l.filter((e) => e.blocked);
    // Access: the NIBSS test bank; A43 shared by Blooms MFB and Corestep MFB; D92 shared by Jessefield and Jubilee Life; Blooms MFB also listed under E43
    expect(blocked(access.entries).map((e) => e.code).sort()).toEqual(["039_", "A43", "A43", "D92", "D92", "E43"]);
    // First Bank: four codes with a lost leading zero, and five mobile-money style names that each appear under two codes (Fortis Mobile, M-Kudi, MoneyBox, NEXIM, Zenith Mobile)
    expect(blocked(first.entries).map((e) => e.code).sort()).toEqual(["024", "308", "313", "322", "325", "405", "61", "62", "837", "840", "842", "843", "95", "99"]);
    for (const e of [...blocked(access.entries), ...blocked(first.entries)]) expect(e.reason).toMatch(/test|shares|more than one code|leading zero/i);
  });

  it("keep the large banks payable on both lists", () => {
    for (const l of [access, first]) for (const code of ["044", "058", "057", "033", "011"]) expect(l.entries.find((e) => e.code === code)?.blocked, code).toBe(false);
  });
});

describe("turning an employee's bank name into a code, on the paying bank's OWN list only", () => {
  const access = addKnownAliases(parseCodeList(BUILT_IN_CODE_LISTS.ACCESS_BANK.csv).entries);
  const first = addKnownAliases(parseCodeList(BUILT_IN_CODE_LISTS.FIRST_BANK.csv).entries);

  it("gives each bank's own code for the same bank: Stanbic IBTC is 039 for Access and 221 for First Bank; Kuda is A98 and 770", () => {
    expect(resolveInList("Stanbic IBTC", access)).toMatchObject({ code: "039" });
    expect(resolveInList("Stanbic IBTC", first)).toMatchObject({ code: "221" });
    expect(resolveInList("Kuda Microfinance Bank", access)).toMatchObject({ code: "A98" });
    expect(resolveInList("Kuda Microfinance Bank", first)).toMatchObject({ code: "770" });
  });

  it("finds the bank under the names employees' records use (GTBank, GTB, UBA, FirstBank), by name and never by code", () => {
    for (const name of ["GTBank", "GTB", "GT Bank", "Guaranty Trust Bank", "GTCO"]) expect(resolveInList(name, first)?.code, name).toBe("058");
    for (const name of ["UBA", "United Bank for Africa"]) expect(resolveInList(name, first)?.code, name).toBe("033");
    expect(resolveInList("FirstBank", access)?.code).toBe("011");
    // an alias never turns one bank into another: a mobile product keeps its own entry
    expect(resolveInList("Zenith Bank", first)?.code).toBe("057");
  });

  it("agrees where the banks agree", () => {
    for (const name of ["GTBank", "Zenith Bank", "UBA", "First Bank", "Access Bank"]) expect(resolveInList(name, access)?.code, name).toBe(resolveInList(name, first)?.code);
  });

  it("says nothing for a bank that is not on the list, and flags one that is on it only as a blocked entry", () => {
    expect(resolveInList("Atlantis Savings", access)).toBeNull();
    const demo: ParsedCode[] = [{ name: "BLOOMS MFB", code: "A43", blocked: true, reason: "Shares code A43 with CORESTEP MICROFINANCE BANK", aliases: [] }];
    expect(resolveInList("Blooms MFB", demo)).toMatchObject({ blocked: true });
  });
});

describe("file layouts, as data", () => {
  it("First Bank's layout is exactly the six headers of its upload template, in order", () => {
    expect(FIRST_BANK_LAYOUT.columns.map((c) => c.header)).toEqual(["DebitAccountNo", "CreditAccountNo", "CreditBankCode", "BeneficiaryName", "Narration", "Amount"]);
    expect(validateLayout(FIRST_BANK_LAYOUT)).toEqual([]);
    expect(validateLayout(GENERIC_LAYOUT)).toEqual([]);
    expect(GENERIC_LAYOUT.columns.map((c) => c.header)).toEqual(["Name", "Account Number", "Bank Code", "Amount", "Payment Description"]);
  });

  it("builds First Bank's rows: the debit account on every row, accounts and codes as text (leading zeros kept), the amount as a number", () => {
    const rows = [
      { transactionId: "t1", name: "STAFF ONE", accountNumber: "0123456789", bankCode: "058", amount: 95200.5, description: "Salary October 2026" },
      { transactionId: "t2", name: "STAFF TWO", accountNumber: "2000000001", bankCode: "221", amount: 120000, description: "Salary October 2026" },
    ];
    const cells = layoutCells(FIRST_BANK_LAYOUT, rows, "0098765432");
    expect(cells.header).toEqual(["DebitAccountNo", "CreditAccountNo", "CreditBankCode", "BeneficiaryName", "Narration", "Amount"]);
    expect(cells.body).toEqual([
      ["0098765432", "0123456789", "058", "STAFF ONE", "Salary October 2026", 95200.5],
      ["0098765432", "2000000001", "221", "STAFF TWO", "Salary October 2026", 120000],
    ]);
    expect(cells.textColumns).toEqual([0, 1, 2]);
  });

  it("refuses a layout that cannot pay anyone: no credit account, no bank code, no amount, a repeated or empty header, an unknown source", () => {
    const col = (header: string, source: string) => ({ header, source }) as never;
    const ok = [col("Acct", "CREDIT_ACCOUNT"), col("Code", "BANK_CODE"), col("Amt", "AMOUNT")];
    const mk = (columns: unknown[]) => ({ ...FIRST_BANK_LAYOUT, columns }) as never;
    expect(validateLayout(mk(ok))).toEqual([]);
    expect(validateLayout(mk(ok.slice(1))).join(" ")).toMatch(/beneficiary account/i);
    expect(validateLayout(mk([ok[0], ok[2]])).join(" ")).toMatch(/bank code/i);
    expect(validateLayout(mk([ok[0], ok[1]])).join(" ")).toMatch(/amount/i);
    expect(validateLayout(mk([...ok, col("Acct", "NARRATION")])).join(" ")).toMatch(/more than once/i);
    expect(validateLayout(mk([...ok, col("", "NARRATION")])).join(" ")).toMatch(/header/i);
    expect(validateLayout(mk([...ok, col("X", "SOMETHING_ELSE")])).join(" ")).toMatch(/not a known source/i);
  });

  it("is edited as plain text, one column per line, and the text round-trips", () => {
    const text = layoutToText(FIRST_BANK_LAYOUT);
    expect(text.split("\n")[0]).toBe("DebitAccountNo = DEBIT_ACCOUNT");
    const back = parseLayoutText(text, FIRST_BANK_LAYOUT);
    expect(back.columns).toEqual(FIRST_BANK_LAYOUT.columns);
    expect(parseLayoutText("Fixed one = FIXED:ABC\nAcct = CREDIT_ACCOUNT", FIRST_BANK_LAYOUT).columns[0]).toEqual({ header: "Fixed one", source: "FIXED", fixed: "ABC" });
    expect(() => parseLayoutText("no equals sign here", FIRST_BANK_LAYOUT)).toThrow(/Header = SOURCE/);
  });
});
