import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

// Demo data safeguard (decision 9 of the register, design approved by the founder on 2026-11-19): the seed's data is entirely fictional. This checks what CAN be checked about a value looking real:
// every email is on a reserved test domain, every tax ID and pension PIN carries the synthetic prefix the seed gives it, and no text field holds an 11-digit number that could be a national identity
// number (the phone column is the one place an 11-digit number is expected). LIMIT, stated plainly: a seeded bank account number is a random 10-digit number, and a random 10-digit number could by
// chance be somebody's real account; nothing can prove it is not. That is why a demo company is blocked from making a bank file (demo-company.test.ts) and why the seed is never run against a real database.

const ELEVEN_DIGITS = /(?<!\d)\d{11}(?!\d)/;
// the companies the seed makes, found by what they are called and not by the demo flag: a few other tests switch the demo company to an ordinary company for their own purposes (tests/helpers.ts)
// Other tests add their own people to these companies, with their own kinds of values, so only what existed when the seed finished is looked at. The seed's last act is to mark every company it made as a demo company,
// which moves the updated time of a company no other test touches (NGL) to the moment the seed finished.
const seedEnd = async () => (await db.organization.findUniqueOrThrow({ where: { code: "NGL" }, select: { updatedAt: true } })).updatedAt;
const SEEDED = { code: { in: ["DSS", "NGL", "THREEROOTS", "ACMEFAC"] } };

describe("the seed's data looks fictional", () => {
  it("every employee email is on a reserved test domain, and every tax ID and pension PIN has the seed's synthetic prefix", async () => {
    const employees = await db.employee.findMany({ where: { organization: SEEDED, createdAt: { lte: await seedEnd() } }, select: { employeeNumber: true, email: true, taxId: true, pensionPin: true } });
    expect(employees.length).toBeGreaterThan(100);
    const badEmail = employees.filter((e) => e.email && !/\.test$/i.test(e.email)).map((e) => e.employeeNumber);
    const badTax = employees.filter((e) => e.taxId && !/^TIN-?[A-Z0-9]+$/.test(e.taxId)).map((e) => e.employeeNumber);
    const badPin = employees.filter((e) => e.pensionPin && !/^PEN\d+$/.test(e.pensionPin)).map((e) => e.employeeNumber);
    expect({ badEmail, badTax, badPin }).toEqual({ badEmail: [], badTax: [], badPin: [] });
  });

  it("every user's email is on a reserved test domain", async () => {
    const users = await db.user.findMany({ where: { organization: SEEDED, createdAt: { lte: await seedEnd() } }, select: { email: true } });
    expect(users.length).toBeGreaterThan(10);
    expect(users.filter((u) => !/\.test$/i.test(u.email)).map((u) => u.email)).toEqual([]);
  });

  it("no employee text field except the phone holds a number that could be a national identity number (11 digits)", async () => {
    const employees = await db.employee.findMany({
      where: { organization: SEEDED, createdAt: { lte: await seedEnd() } },
      select: { employeeNumber: true, firstName: true, middleName: true, lastName: true, address: true, accountName: true, taxId: true, pensionPin: true, pfa: true, bankName: true },
    });
    // (the pension PIN is "PEN" and twelve digits by design, a synthetic format that is not eleven digits)
    const hits = employees.filter((e) => Object.values(e).some((v) => typeof v === "string" && ELEVEN_DIGITS.test(v))).map((e) => e.employeeNumber);
    expect(hits).toEqual([]);
  });

  it("every seeded bank account number is ten digits, as an account number is (the limit above: it cannot be proved not to be somebody's real number)", async () => {
    const employees = await db.employee.findMany({ where: { organization: SEEDED, createdAt: { lte: await seedEnd() }, accountNumber: { not: null } }, select: { accountNumber: true } });
    expect(employees.length).toBeGreaterThan(50);
    expect(employees.filter((e) => !/^\d{10}$/.test(e.accountNumber!)).length).toBe(0);
  });
});
