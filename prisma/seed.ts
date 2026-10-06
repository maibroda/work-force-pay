/**
 * WorkforcePay demo seed.
 * Organization: Demo Security Services Ltd — 5 clients, 8 contracts, 20 beats (10 bid groups),
 * 110 employees, 3 payroll periods (Jul & Aug 2026 locked, Sep 2026 open), movements,
 * work register, overtime, arrears, deductions, joiners, leavers and duplicate test cases.
 *
 * WARNING: this TRUNCATES every WorkforcePay table before seeding.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "../src/lib/auth/context";
import { addDays, d, eachDay, iso } from "../src/lib/dates";
import { leaveEligibility } from "../src/lib/leave";
import { NTA_2025_BANDS } from "../src/lib/payroll/paye";
import { DEFAULT_EARNINGS } from "../src/lib/payroll/structure";
import { db } from "../src/lib/db";
import { createStructure } from "../src/server/services/structures";
import { createMovement } from "../src/server/services/operations";
import {
  approveArrears,
  approveDeduction,
  approveOtherEarning,
  approveOvertime,
  createArrears,
  createDeduction,
  createOtherEarning,
  createOvertime,
} from "../src/server/services/inputs";
import {
  approveRun,
  createPeriod,
  lockRun,
  overrideIssue,
  runPayroll,
  submitForApproval,
} from "../src/server/services/payroll";
import { createPaymentBatches, generateRemittances, markBatchPaid } from "../src/server/services/payments";
import { ensureDefaultChart } from "../src/server/services/accounting";
import { applyForLeave, decideLeave } from "../src/server/services/leave";
import { seedHrDemo, seedInventoryDemo, seedLoanDemo, seedPersonalRecordsDemo, seedAppraisalDemo, seedTrainingDemo } from "./hr-demo";

export const DEMO_PASSWORD = "Password123!";

// Deterministic PRNG so the demo data is identical on every machine.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260921);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

const FIRST = [
  "Adewale",
  "Chinedu",
  "Ibrahim",
  "Oluwaseun",
  "Emeka",
  "Musa",
  "Tunde",
  "Kelechi",
  "Yusuf",
  "Babatunde",
  "Obinna",
  "Abdullahi",
  "Segun",
  "Ifeanyi",
  "Aliyu",
  "Femi",
  "Uche",
  "Sani",
  "Kunle",
  "Chukwuma",
  "Gbenga",
  "Nnamdi",
  "Bello",
  "Dapo",
  "Ikenna",
  "Umar",
  "Rotimi",
  "Chidi",
  "Haruna",
  "Tope",
  "Blessing",
  "Ngozi",
  "Aisha",
  "Funke",
  "Chioma",
  "Zainab",
  "Bukola",
  "Amaka",
  "Hadiza",
  "Yetunde",
];
const LAST = [
  "Okafor",
  "Adeyemi",
  "Bello",
  "Okonkwo",
  "Mohammed",
  "Balogun",
  "Eze",
  "Abubakar",
  "Olawale",
  "Nwosu",
  "Ogunleye",
  "Suleiman",
  "Adebayo",
  "Chukwu",
  "Danjuma",
  "Afolabi",
  "Obi",
  "Garba",
  "Oyelaran",
  "Uzor",
  "Akinola",
  "Ibekwe",
  "Lawal",
  "Nwachukwu",
  "Ojo",
  "Usman",
  "Onyeka",
  "Salami",
  "Ekwueme",
  "Idowu",
];
const BANKS = [
  "Access Bank",
  "GTBank",
  "Zenith Bank",
  "First Bank",
  "UBA",
  "Fidelity Bank",
  "Wema Bank",
  "Stanbic IBTC Bank",
];
const PFAS = [
  "Stanbic IBTC Pension Managers",
  "Access ARM Pensions",
  "Leadway Pensure PFA",
  "Premium Pension Ltd",
  "Crusader Sterling Pensions",
];

async function truncateAll() {
  const tables = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length)
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

async function seedStatutory(orgId: string) {
  await db.taxRule.create({
    data: {
      organizationId: orgId,
      code: "NG-PAYE-NTA2025",
      name: "Nigeria PAYE — Nigeria Tax Act 2025",
      version: "2026.1",
      legalBasis:
        "Nigeria Tax Act 2025, personal income tax schedule effective 1 January 2026. Consolidated Relief Allowance abolished; rent relief 20% of annual rent capped at ₦500,000; pension contributions deductible. VERIFY against current law and NRS guidance before production use.",
      effectiveFrom: d("2026-01-01"),
      bands: {
        create: NTA_2025_BANDS.map((b, i) => ({
          sortOrder: i + 1,
          lowerBound: b.lowerBound,
          upperBound: b.upperBound,
          rate: b.rate,
        })),
      },
      reliefs: {
        create: [
          { code: "PENSION", name: "Employee pension contribution", type: "EMPLOYEE_PENSION" },
          {
            code: "RENT",
            name: "Rent relief (20% of annual rent, max ₦500,000)",
            type: "PERCENT_OF_RENT_CAPPED",
            rate: 20,
            cap: 500000,
          },
          {
            code: "NHF",
            name: "National Housing Fund (2.5% of basic)",
            type: "NHF",
            rate: 2.5,
            active: false,
          },
        ],
      },
      exemptions: {
        create: [
          {
            code: "MIN_WAGE",
            description: "Earners of the national minimum wage (₦70,000/month) or less are exempt",
            annualGrossCeiling: 840000,
          },
        ],
      },
    },
  });
  await db.pensionRule.create({
    data: {
      organizationId: orgId,
      version: "PRA2014-v1",
      employeeRate: 8,
      employerRate: 10,
      pensionableCodes: ["BASIC", "HOUSING", "TRANSPORT"],
      effectiveFrom: d("2020-01-01"),
    },
  });
  await db.payrollRule.create({
    data: {
      organizationId: orgId,
      version: "2026.1",
      prorationBasis: "CALENDAR_DAYS",
      defaultOperativeSharePct: 70,
      standardHoursPerDay: 12,
      overtimeMultiplier: 1.5,
      maxOvertimeHoursPerMonth: 60,
      maxDeductionPctOfGross: 33.33,
      effectiveFrom: d("2020-01-01"),
    },
  });
  await db.employerCostRule.create({
    data: {
      organizationId: orgId,
      version: "2026.1",
      itfPct: 1,
      nsitfPct: 1,
      nhfMedicalPct: 0,
      insurancePct: 7.5,
      uniformKitsPct: 25,
      recruitmentTrainingPct: 10.5,
      leaveRelieverPct: 22,
      outsourcingLeaveAllowancePct: 20,
      effectiveFrom: d("2020-01-01"),
    },
  });
  await db.numberingRule.createMany({
    data: [
      { organizationId: orgId, entity: "EMPLOYEE", prefix: "EMP", digits: 6, nextNumber: 1 },
      { organizationId: orgId, entity: "CLIENT", prefix: "CLT", digits: 4, nextNumber: 1 },
      { organizationId: orgId, entity: "CONTRACT", prefix: "CON", digits: 5, nextNumber: 1 },
      { organizationId: orgId, entity: "BEAT", prefix: "BT", digits: 5, nextNumber: 1 },
      { organizationId: orgId, entity: "PAYMENT_BATCH", prefix: "PAY", digits: 6, nextNumber: 1 },
    ],
  });
}

const pct = (arr: number[]) =>
  DEFAULT_EARNINGS.map((c, i) => ({
    code: c.code,
    name: c.name,
    calcType: "PERCENTAGE" as const,
    percentage: arr[i],
    taxable: true,
    pensionable: c.pensionable,
    employerCost: false,
    active: true,
  }));

async function main() {
  console.log("→ Resetting database");
  await truncateAll();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ─────────────── Organization, users ───────────────
  const org = await db.organization.create({
    data: {
      name: "Demo Security Services Ltd",
      code: "DSS",
      address: "12 Adeola Odeku Street, Victoria Island, Lagos",
      phone: "+234 1 460 0000",
      email: "info@demosecurity.ng",
    },
  });
  const roles = [
    ["SUPER_ADMIN", "superadmin@workforcepay.test", "Platform Super Admin"],
    ["COMPANY_ADMIN", "admin@demosecurity.test", "Adaeze Company Admin"],
    ["HR_ADMIN", "hr@demosecurity.test", "Halima HR Admin"],
    ["OPERATIONS", "ops@demosecurity.test", "Olumide Operations"],
    ["PAYROLL_ADMIN", "payroll@demosecurity.test", "Paul Payroll Admin"],
    ["FINANCE", "finance@demosecurity.test", "Folake Finance"],
    ["AUDITOR", "auditor@demosecurity.test", "Audu Auditor"],
    ["SUPERVISOR", "supervisor@demosecurity.test", "Sunday Supervisor"],
  ] as const;
  const users: Record<string, { id: string; name: string; email: string }> = {};
  for (const [role, email, name] of roles) {
    users[role] = await db.user.create({
      data: { organizationId: org.id, email, name, role, passwordHash: hash },
    });
  }
  const ctx = (role: keyof typeof users): Ctx => ({
    userId: users[role].id,
    orgId: org.id,
    role: role as Ctx["role"],
    name: users[role].name,
    email: users[role].email,
  });
  const admin = ctx("COMPANY_ADMIN");
  const finance = ctx("FINANCE");
  await seedStatutory(org.id);
  await ensureDefaultChart(db, org.id);

  // ─────────────── Departments & categories ───────────────
  const dept = {
    OPS: await db.department.create({ data: { organizationId: org.id, code: "OPS", name: "Operations" } }),
    ADM: await db.department.create({
      data: { organizationId: org.id, code: "ADM", name: "Administration" },
    }),
    FIN: await db.department.create({ data: { organizationId: org.id, code: "FIN", name: "Finance" } }),
  };
  const cat = {
    GUARD: await db.employeeCategory.create({
      data: { organizationId: org.id, code: "GUARD", name: "Security Guard" },
    }),
    SUP: await db.employeeCategory.create({
      data: { organizationId: org.id, code: "SUP", name: "Site Supervisor" },
    }),
    DOG: await db.employeeCategory.create({
      data: { organizationId: org.id, code: "DOG", name: "Dog Handler" },
    }),
    ESC: await db.employeeCategory.create({
      data: { organizationId: org.id, code: "ESC", name: "Escort Officer" },
    }),
    OFF: await db.employeeCategory.create({
      data: { organizationId: org.id, code: "OFF", name: "Office Staff" },
    }),
  };

  // ─────────────── Salary structures ───────────────
  console.log("→ Salary structures");
  const std = await db.salaryStructure.create({
    data: {
      organizationId: org.id,
      code: "STD",
      name: "Standard Security Workforce Structure",
      description:
        "Default earnings structure — percentages of the operative's 70% share of the agreed client rate.",
      isDefault: true,
      status: "ACTIVE",
      effectiveFrom: d("2020-01-01"),
      components: {
        create: DEFAULT_EARNINGS.map((c, i) => ({
          code: c.code,
          name: c.name,
          calcType: "PERCENTAGE",
          percentage: c.percentage!,
          taxable: true,
          pensionable: c.pensionable,
          sortOrder: i + 1,
        })),
      },
    },
  });
  const effective = "2026-01-01";
  const premium = await createStructure(admin, {
    code: "PREMIUM",
    name: "Premium Security Structure",
    description: "Higher basic/medical share for premium sites.",
    effectiveFrom: effective,
    activate: true,
    components: pct([15, 15, 15, 5, 10, 15, 5, 10, 10]),
  });
  const supv = await createStructure(admin, {
    code: "SUPV",
    name: "Supervisor Structure",
    description: "Supervisors & site leads.",
    effectiveFrom: effective,
    activate: true,
    components: pct([20, 20, 15, 5, 10, 15, 5, 5, 5]),
  });
  const abcStruct = await createStructure(admin, {
    code: "ABC-GUARD",
    name: "ABC Bank Guard Structure (Client A Custom)",
    description: "Client-specific structure agreed with ABC Bank.",
    effectiveFrom: effective,
    activate: true,
    components: pct([12, 15, 13, 5, 15, 20, 3, 5, 12]),
  });
  const xyzStruct = await createStructure(admin, {
    code: "XYZ-GUARD",
    name: "XYZ Manufacturing Guard Structure (Client B Custom)",
    description: "Percentages plus a fixed hazard allowance and a formula risk allowance for factory sites.",
    calculationMethod: "MIXED",
    effectiveFrom: effective,
    activate: true,
    components: [
      ...pct([11, 14, 14, 5, 16, 20, 2.5, 5, 12.5]),
      {
        code: "HAZARD",
        name: "Hazard Allowance",
        calcType: "FIXED_AMOUNT",
        fixedAmount: 5000,
        taxable: true,
        pensionable: false,
        employerCost: false,
        active: true,
      },
      {
        code: "RISK",
        name: "Risk Allowance",
        calcType: "FORMULA",
        formula: "MIN(GROSS * 2%, 3000)",
        taxable: true,
        pensionable: false,
        employerCost: false,
        active: true,
      },
    ],
  });

  // ─────────────── Clients, contracts, rates ───────────────
  console.log("→ Clients, contracts, beats");
  const mkClient = (code: string, name: string, contactPerson: string, address: string) =>
    db.client.create({
      data: {
        organizationId: org.id,
        code,
        name,
        contactPerson,
        address,
        phone: "+234 80" + Math.floor(10000000 + rand() * 89999999),
        email: `security@${code.toLowerCase()}.ng`,
        status: "ACTIVE",
        startDate: d("2024-01-01"),
      },
    });
  const clients = {
    ABC: await mkClient(
      "ABC",
      "ABC Bank",
      "Mrs. Ronke Adeleke",
      "Plot 1 Ahmadu Bello Way, Victoria Island, Lagos",
    ),
    XYZ: await mkClient("XYZ", "XYZ Manufacturing", "Engr. Tayo Bamidele", "Lekki Free Trade Zone, Lagos"),
    GLB: await mkClient("GLB", "Global Insurance", "Mr. Kayode Martins", "35 Broad Street, Lagos Island"),
    RTL: await mkClient("RTL", "Retail Client Ltd", "Ms. Joy Eke", "Ikeja City Mall, Alausa, Lagos"),
    IND: await mkClient(
      "IND",
      "Industrial Client Plc",
      "Mr. Ibinabo George",
      "Trans-Amadi Industrial Layout, Port Harcourt",
    ),
  };
  const mkContract = (
    client: { id: string },
    contractNumber: string,
    name: string,
    value: number,
    structureId: string,
  ) =>
    db.contract.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        contractNumber,
        name,
        startDate: d("2026-01-01"),
        endDate: d("2026-12-31"),
        contractValue: value,
        operativeSharePct: 70,
        defaultStructureId: structureId,
        status: "ACTIVE",
      },
    });
  const con = {
    ABC: await mkContract(clients.ABC, "CON-ABC-2026", "Security Services 2026", 60_000_000, abcStruct.id),
    ABC_ESC: await mkContract(
      clients.ABC,
      "CON-ABC-ESC-2026",
      "Cash-in-Transit Escort 2026",
      18_000_000,
      premium.id,
    ),
    XYZ: await mkContract(clients.XYZ, "CON-XYZ-2026", "Security Contract 2026", 48_000_000, xyzStruct.id),
    GLB: await mkContract(clients.GLB, "CON-GLB-2026", "Branch Security 2026", 30_000_000, std.id),
    RTL: await mkContract(clients.RTL, "CON-RTL-2026", "Mall Security 2026", 25_000_000, std.id),
    IND: await mkContract(
      clients.IND,
      "CON-IND-2026",
      "Industrial Site Security 2026",
      40_000_000,
      premium.id,
    ),
    IND_K9: await mkContract(clients.IND, "CON-IND-K9-2026", "K9 Patrol 2026", 12_000_000, premium.id),
    XYZ_SUP: await mkContract(clients.XYZ, "CON-XYZ-SUP-2026", "Site Supervision 2026", 9_000_000, supv.id),
  };
  // CLIENT → CONTRACT → CATEGORY → STRUCTURE → AGREED RATE (effective-dated)
  const rate = (
    contractId: string,
    categoryId: string,
    salaryStructureId: string,
    agreedRate: number,
    from = "2026-01-01",
    to?: string,
  ) =>
    db.contractRate.create({
      data: {
        organizationId: org.id,
        contractId,
        categoryId,
        salaryStructureId,
        agreedRate,
        effectiveFrom: d(from),
        effectiveTo: to ? d(to) : null,
      },
    });
  await rate(con.ABC.id, cat.GUARD.id, abcStruct.id, 120_000);
  await rate(con.ABC.id, cat.SUP.id, supv.id, 180_000);
  await rate(con.ABC_ESC.id, cat.ESC.id, premium.id, 150_000);
  await rate(con.XYZ.id, cat.GUARD.id, xyzStruct.id, 135_000);
  await rate(con.XYZ.id, cat.DOG.id, premium.id, 160_000);
  await rate(con.XYZ_SUP.id, cat.SUP.id, supv.id, 175_000);
  // Effective-dated increase: Global Insurance ₦100,000 → ₦120,000 from 1 July 2026
  await rate(con.GLB.id, cat.GUARD.id, std.id, 100_000, "2026-01-01", "2026-06-30");
  await rate(con.GLB.id, cat.GUARD.id, std.id, 120_000, "2026-07-01");
  await rate(con.GLB.id, cat.SUP.id, supv.id, 165_000);
  await rate(con.RTL.id, cat.GUARD.id, std.id, 110_000);
  await rate(con.RTL.id, cat.SUP.id, supv.id, 160_000);
  await rate(con.IND.id, cat.GUARD.id, premium.id, 125_000);
  await rate(con.IND.id, cat.SUP.id, supv.id, 170_000);
  await rate(con.IND_K9.id, cat.DOG.id, premium.id, 155_000);

  // ─────────────── Beats (20) grouped into 10 bids ───────────────
  let beatSeq = 1;
  const mkBeat = (
    contract: { id: string; clientId: string },
    name: string,
    bid: string,
    region: string,
    state: string,
    lga: string,
    approvedStrength: number,
    supervisorId?: string,
  ) =>
    db.beat.create({
      data: {
        organizationId: org.id,
        clientId: contract.clientId,
        contractId: contract.id,
        code: `BT-${String(beatSeq++).padStart(5, "0")}`,
        name,
        bidReference: bid,
        region,
        state,
        lga,
        address: `${name}, ${lga}, ${state}`,
        siteContact: "Site Manager",
        approvedStrength,
        status: "UNMAPPED",
        startDate: d("2026-01-01"),
        supervisorId,
      },
    });
  const sup = users.SUPERVISOR.id;
  const beat = {
    VI: await mkBeat(
      con.ABC,
      "Victoria Island Branch",
      "BID-ABC-LAGOS-ISLAND",
      "Lagos",
      "Lagos",
      "Eti-Osa",
      8,
      sup,
    ),
    MARINA: await mkBeat(
      con.ABC,
      "Marina Branch",
      "BID-ABC-LAGOS-ISLAND",
      "Lagos",
      "Lagos",
      "Lagos Island",
      6,
      sup,
    ),
    IKOYI: await mkBeat(con.ABC, "Ikoyi Branch", "BID-ABC-LAGOS-ISLAND", "Lagos", "Lagos", "Eti-Osa", 6, sup),
    IKEJA_ABC: await mkBeat(
      con.ABC,
      "Ikeja GRA Branch",
      "BID-ABC-LAGOS-MAINLAND",
      "Lagos",
      "Lagos",
      "Ikeja",
      5,
    ),
    CIT: await mkBeat(con.ABC_ESC, "Cash-in-Transit Lagos", "BID-ABC-CIT", "Lagos", "Lagos", "Ikeja", 5),
    LEKKI: await mkBeat(con.XYZ, "Lekki", "BID-XYZ-LAGOS", "Lagos", "Lagos", "Ibeju-Lekki", 7),
    AGBARA: await mkBeat(con.XYZ, "Agbara Factory", "BID-XYZ-OGUN", "South-West", "Ogun", "Ado-Odo/Ota", 6),
    OTA: await mkBeat(con.XYZ, "Ota Warehouse", "BID-XYZ-OGUN", "South-West", "Ogun", "Ado-Odo/Ota", 4),
    APAPA: await mkBeat(con.XYZ_SUP, "Apapa Depot", "BID-XYZ-LAGOS", "Lagos", "Lagos", "Apapa", 3),
    GLB_HQ: await mkBeat(
      con.GLB,
      "Broad Street Head Office",
      "BID-GLB-LAGOS",
      "Lagos",
      "Lagos",
      "Lagos Island",
      6,
    ),
    GLB_IBD: await mkBeat(
      con.GLB,
      "Ibadan Branch",
      "BID-GLB-REGIONS",
      "South-West",
      "Oyo",
      "Ibadan North",
      4,
    ),
    GLB_PH: await mkBeat(
      con.GLB,
      "Port Harcourt Branch",
      "BID-GLB-REGIONS",
      "South-South",
      "Rivers",
      "Port Harcourt",
      4,
    ),
    GLB_KANO: await mkBeat(con.GLB, "Kano Branch", "BID-GLB-REGIONS", "North-West", "Kano", "Nassarawa", 3),
    MALL_IKJ: await mkBeat(con.RTL, "Ikeja City Mall", "BID-RTL-MALLS", "Lagos", "Lagos", "Ikeja", 6),
    MALL_LEK: await mkBeat(con.RTL, "Lekki Mall", "BID-RTL-MALLS", "Lagos", "Lagos", "Eti-Osa", 5),
    SURU: await mkBeat(con.RTL, "Surulere Store", "BID-RTL-MALLS", "Lagos", "Lagos", "Surulere", 3),
    ONNE: await mkBeat(con.IND, "Onne Oil & Gas Base", "BID-IND-RIVERS", "South-South", "Rivers", "Eleme", 7),
    TRANS: await mkBeat(
      con.IND,
      "Trans-Amadi Yard",
      "BID-IND-RIVERS",
      "South-South",
      "Rivers",
      "Obio/Akpor",
      5,
    ),
    WARRI: await mkBeat(
      con.IND_K9,
      "Warri K9 Patrol",
      "BID-IND-DELTA",
      "South-South",
      "Delta",
      "Warri South",
      4,
    ),
    // New activation this month — intentionally left UNMAPPED
    KADUNA: await mkBeat(con.IND, "Kaduna Plant", "BID-IND-DELTA", "North-West", "Kaduna", "Chikun", 4),
  };
  await db.beat.update({
    where: { id: beat.KADUNA.id },
    data: { createdAt: new Date(), startDate: d("2026-09-15") },
  });
  await db.numberingRule.update({
    where: { organizationId_entity: { organizationId: org.id, entity: "BEAT" } },
    data: { nextNumber: beatSeq },
  });
  await db.numberingRule.update({
    where: { organizationId_entity: { organizationId: org.id, entity: "CLIENT" } },
    data: { nextNumber: 6 },
  });

  // ─────────────── Employees (110) ───────────────
  console.log("→ Employees");
  type Plan = {
    cat: keyof typeof cat;
    beat: keyof typeof beat | null;
    empDate: string;
    status?: "ACTIVE" | "RESIGNED" | "TERMINATED" | "SUSPENDED";
    exit?: string;
  };
  const plan: Plan[] = [];
  const guardBeats: Array<[keyof typeof beat, number]> = [
    ["VI", 7],
    ["MARINA", 6],
    ["IKOYI", 6],
    ["IKEJA_ABC", 5],
    ["LEKKI", 7],
    ["AGBARA", 6],
    ["OTA", 3],
    ["GLB_HQ", 6],
    ["GLB_IBD", 4],
    ["GLB_PH", 4],
    ["GLB_KANO", 2],
    ["MALL_IKJ", 7],
    ["MALL_LEK", 5],
    ["SURU", 3],
    ["ONNE", 7],
    ["TRANS", 4],
  ];
  const date = () =>
    `20${pick(["19", "20", "21", "22", "23", "24", "25"])}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`;
  for (const [b, n] of guardBeats)
    for (let i = 0; i < n; i++) plan.push({ cat: "GUARD", beat: b, empDate: date() });
  // supervisors, escorts, dog handlers
  plan.push(
    { cat: "SUP", beat: "VI", empDate: "2020-03-01" },
    { cat: "SUP", beat: "APAPA", empDate: "2021-06-01" },
    { cat: "SUP", beat: "APAPA", empDate: "2022-02-01" },
    { cat: "SUP", beat: "MALL_IKJ", empDate: "2021-09-01" },
    { cat: "SUP", beat: "ONNE", empDate: "2019-11-01" },
    { cat: "SUP", beat: "GLB_HQ", empDate: "2023-04-01" },
  );
  for (let i = 0; i < 5; i++) plan.push({ cat: "ESC", beat: "CIT", empDate: date() });
  for (let i = 0; i < 4; i++) plan.push({ cat: "DOG", beat: "WARRI", empDate: date() });
  plan.push({ cat: "DOG", beat: "LEKKI", empDate: date() });
  // office staff paid on employee pay rates (no beat)
  for (let i = 0; i < 4; i++) plan.push({ cat: "OFF", beat: null, empDate: date() });
  // EMP-000025 must be at Victoria Island on 1 Sept — force slot 25
  plan[24] = { cat: "GUARD", beat: "VI", empDate: "2022-05-16" };
  // Joiners in September 2026
  const joiners: Plan[] = [
    { cat: "GUARD", beat: "MALL_LEK", empDate: "2026-09-08" },
    { cat: "GUARD", beat: "GLB_KANO", empDate: "2026-09-15" },
    { cat: "GUARD", beat: "OTA", empDate: "2026-09-10" },
    { cat: "GUARD", beat: "TRANS", empDate: "2026-09-01" },
  ];
  plan.push(...joiners);
  // Leavers in September 2026
  const leavers = [12, 47, 63];
  for (const i of leavers)
    plan[i] = {
      ...plan[i],
      status: i === 47 ? "TERMINATED" : "RESIGNED",
      exit: i === 12 ? "2026-09-14" : i === 47 ? "2026-09-09" : "2026-09-20",
    };
  // A suspended guard
  plan[33] = { ...plan[33], status: "SUSPENDED" };
  while (plan.length < 110)
    plan.push({
      cat: "GUARD",
      beat: pick(["LEKKI", "ONNE", "MALL_IKJ", "IKEJA_ABC"]) as keyof typeof beat,
      empDate: date(),
    });

  const employees: Array<{
    id: string;
    employeeNumber: string;
    beat: keyof typeof beat | null;
    cat: keyof typeof cat;
    empDate: Date;
    exit?: Date;
    status: string;
  }> = [];
  const usedAccounts = new Set<string>();
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const n = i + 1;
    const employeeNumber = `EMP-${String(n).padStart(6, "0")}`;
    const first = pick(FIRST);
    const last = pick(LAST);
    let acct = "";
    do acct = String(Math.floor(1_000_000_000 + rand() * 8_999_999_999));
    while (usedAccounts.has(acct));
    usedAccounts.add(acct);
    const e = await db.employee.create({
      data: {
        organizationId: org.id,
        employeeNumber,
        firstName: first,
        middleName: rand() > 0.6 ? pick(FIRST) : null,
        lastName: last,
        gender: [
          "Blessing",
          "Ngozi",
          "Aisha",
          "Funke",
          "Chioma",
          "Zainab",
          "Bukola",
          "Amaka",
          "Hadiza",
          "Yetunde",
        ].includes(first)
          ? "FEMALE"
          : "MALE",
        dateOfBirth: d(
          `19${70 + Math.floor(rand() * 30)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`,
        ),
        phone: `080${Math.floor(10000000 + rand() * 89999999)}`,
        email: `${first}.${last}${n}@mail.test`.toLowerCase(),
        address: `${Math.floor(1 + rand() * 90)} ${pick(["Allen Avenue", "Herbert Macaulay Way", "Ogunlana Drive", "Aba Road", "Zik Avenue", "Isaac John Street"])}`,
        employmentDate: d(p.empDate),
        exitDate: p.exit ? d(p.exit) : null,
        status: p.status ?? "ACTIVE",
        categoryId: cat[p.cat].id,
        departmentId: p.cat === "OFF" ? (i % 2 ? dept.FIN.id : dept.ADM.id) : dept.OPS.id,
        bankName: pick(BANKS),
        accountNumber: acct,
        accountName: `${first} ${last}`.toUpperCase(),
        taxId: `TIN-${String(20000000 + n * 7919).slice(0, 8)}`,
        pensionPin: `PEN${String(100200300000 + n * 131)}`,
        pfa: pick(PFAS),
        annualRent: p.cat === "OFF" || p.cat === "SUP" ? 600000 : null,
      },
    });
    employees.push({
      id: e.id,
      employeeNumber,
      beat: p.beat,
      cat: p.cat,
      empDate: d(p.empDate),
      exit: p.exit ? d(p.exit) : undefined,
      status: p.status ?? "ACTIVE",
    });
  }
  await db.numberingRule.update({
    where: { organizationId_entity: { organizationId: org.id, entity: "EMPLOYEE" } },
    data: { nextNumber: plan.length + 1 },
  });
  const E = (n: number) => employees[n - 1];

  // Duplicate-data test cases (flagged for review — never deleted)
  const e90 = await db.employee.findUniqueOrThrow({ where: { id: E(90).id } });
  await db.employee.update({
    where: { id: E(91).id },
    data: { accountNumber: e90.accountNumber, bankName: e90.bankName },
  }); // shared bank account
  const e70 = await db.employee.findUniqueOrThrow({ where: { id: E(70).id } });
  await db.employee.update({ where: { id: E(71).id }, data: { pensionPin: e70.pensionPin } }); // shared pension PIN
  await db.employee.update({
    where: { id: E(80).id },
    data: { firstName: "Ibrahim", lastName: "Musa", dateOfBirth: d("1988-04-12") },
  });
  await db.employee.update({
    where: { id: E(81).id },
    data: { firstName: "Ibrahm", lastName: "Musa", dateOfBirth: d("1988-04-12") },
  }); // name similarity
  await db.employee.update({
    where: { id: E(88).id },
    data: { bankName: null, accountNumber: null, accountName: null },
  }); // missing bank info
  await db.employee.update({ where: { id: E(60).id }, data: { taxId: null } });

  // Office staff: effective-dated employee pay rates
  for (const e of employees.filter((x) => x.cat === "OFF")) {
    await db.employeePayRate.create({
      data: {
        organizationId: org.id,
        employeeId: e.id,
        monthlyGross: 180000,
        structureCode: "STD",
        reason: "Office staff salary",
        approvedBy: "Managing Director",
        effectiveFrom: d("2026-01-01"),
        effectiveTo: d("2026-07-31"),
      },
    });
    await db.employeePayRate.create({
      data: {
        organizationId: org.id,
        employeeId: e.id,
        monthlyGross: 200000,
        structureCode: "STD",
        reason: "Annual review 2026",
        approvedBy: "Managing Director",
        effectiveFrom: d("2026-08-01"),
      },
    });
  }
  // Employee-specific override: Basic 12% instead of 10%
  await db.employeeSalaryOverride.create({
    data: {
      organizationId: org.id,
      employeeId: E(5).id,
      componentCode: "BASIC",
      calcType: "PERCENTAGE",
      percentage: 12,
      reason: "Long-service recognition approved by HR committee",
      effectiveFrom: d("2026-08-01"),
      approvedBy: "Head of HR",
    },
  });

  // ─────────────── Deployments ───────────────
  console.log("→ Deployments & work register");
  const depStart = (e: (typeof employees)[number]) =>
    e.empDate > d("2026-06-01") ? e.empDate : d("2026-06-01");
  for (const e of employees) {
    if (!e.beat) continue;
    const b = beat[e.beat];
    await db.deployment.create({
      data: {
        organizationId: org.id,
        employeeId: e.id,
        clientId: b.clientId,
        contractId: b.contractId,
        beatId: b.id,
        categoryId: cat[e.cat].id,
        startDate: depStart(e),
        endDate: e.exit ?? null,
        status: e.exit ? "ENDED" : "ACTIVE",
      },
    });
    if (!e.exit)
      await db.employee.update({
        where: { id: e.id },
        data: { currentBeatId: b.id, currentClientId: b.clientId },
      });
  }

  // ─────────────── Work register: Jul, Aug, Sep 2026 ───────────────
  const beatById = new Map(Object.values(beat).map((b) => [b.id, b]));
  const days = eachDay(d("2026-07-01"), d("2026-09-30"));
  const rows: Prisma.WorkRegisterCreateManyInput[] = [];
  const EMP25 = E(25);
  for (const e of employees) {
    if (!e.beat) continue;
    const b = beat[e.beat];
    for (const day of days) {
      if (day < depStart(e) || (e.exit && day > e.exit)) continue;
      if (e.id === EMP25.id && day >= d("2026-09-01")) continue; // handled via staff movement below
      let status: "PRESENT" | "LATE" | "ABSENT" | "OFF" | "SUSPENDED" = "PRESENT";
      const r = rand();
      if (e.status === "SUSPENDED" && day >= d("2026-09-10") && day <= d("2026-09-19")) status = "SUSPENDED";
      else if (r < 0.025) status = "ABSENT";
      else if (r < 0.05) status = "LATE";
      else if (day.getUTCDay() === 0 && r < 0.3) status = "OFF";
      const ot = status === "PRESENT" && rand() < 0.04 ? 2 + Math.floor(rand() * 3) : 0;
      rows.push({
        organizationId: org.id,
        date: day,
        employeeId: e.id,
        clientId: b.clientId,
        contractId: b.contractId,
        beatId: b.id,
        categoryId: cat[e.cat].id,
        shift: rand() > 0.5 ? "DAY" : "NIGHT",
        attendanceStatus: status,
        hoursWorked: ["PRESENT", "LATE"].includes(status) ? 12 : 0,
        overtimeHours: ot,
        supervisor: "Sunday Supervisor",
        source: "SUPERVISOR",
        recordedBy: "Sunday Supervisor",
      });
    }
  }
  await db.workRegister.createMany({ data: rows });
  void beatById;

  // ─────────────── Periods ───────────────
  const jul = await createPeriod(admin, 2026, 7);
  const aug = await createPeriod(admin, 2026, 8);

  // July & August overtime (approved client schedules)
  const otFor = async (
    periodId: string,
    n: number,
    beatKey: keyof typeof beat,
    dateIso: string,
    hours: number,
    ref: string,
  ) => {
    const o = await createOvertime(ctx("PAYROLL_ADMIN"), {
      employeeId: E(n).id,
      beatId: beat[beatKey].id,
      periodId,
      date: dateIso,
      hours,
      approvalReference: ref,
    });
    await approveOvertime(finance, o.id);
    return o;
  };
  await otFor(jul.id, 3, "VI", "2026-07-18", 6, "ABC/OT/JUL/014");
  await otFor(aug.id, 3, "VI", "2026-08-15", 8, "ABC/OT/AUG/022");
  await otFor(aug.id, 30, "LEKKI", "2026-08-09", 6, "XYZ/OT/AUG/007");

  console.log("→ July & August payroll (calculate → validate → approve → lock)");
  const closePeriod = async (periodId: string, pay: boolean) => {
    const run = await runPayroll(ctx("PAYROLL_ADMIN"), periodId);
    const crit = await db.payrollValidationIssue.findMany({
      where: { runId: run.id, severity: "CRITICAL", overridden: false },
    });
    for (const i of crit)
      await overrideIssue(
        finance,
        i.id,
        "Reviewed by Finance for historical demo period — documented exception.",
      );
    await submitForApproval(ctx("PAYROLL_ADMIN"), run.id);
    await approveRun(finance, run.id);
    await lockRun(finance, run.id);
    if (pay) {
      const batches = await createPaymentBatches(finance, run.id);
      for (const b of batches) await markBatchPaid(finance, b.id);
      await generateRemittances(finance, run.id);
    }
    return run;
  };
  await closePeriod(jul.id, true);
  await closePeriod(aug.id, false);

  // ─────────────── September 2026 (OPEN) ───────────────
  console.log("→ September 2026 — movements, exceptions, overtime, arrears, deductions");
  const sep = await createPeriod(admin, 2026, 9);
  const ops = ctx("OPERATIONS");

  // DEMO: EMP-000025 works at FOUR locations in September
  const mv = async (
    n: number,
    to: keyof typeof beat,
    eff: string,
    type: "LOCATION_TRANSFER" | "CLIENT_TRANSFER" | "RELIEF",
    reason: string,
    end?: string,
  ) =>
    createMovement(ops, {
      employeeId: E(n).id,
      toBeatId: beat[to].id,
      movementType: type,
      movementDate: eff,
      effectiveDate: eff,
      endDate: end,
      reason,
      approve: true,
    });
  await mv(
    25,
    "MARINA",
    "2026-09-11",
    "LOCATION_TRANSFER",
    "Marina branch short of guards after two resignations",
  );
  await mv(25, "IKOYI", "2026-09-19", "LOCATION_TRANSFER", "Ikoyi branch security upgrade");
  await mv(
    25,
    "LEKKI",
    "2026-09-26",
    "CLIENT_TRANSFER",
    "Transferred to XYZ Manufacturing Lekki (new client requirement)",
  );
  const e25rows: typeof rows = [];
  const seg: Array<[string, string, keyof typeof beat]> = [
    ["2026-09-01", "2026-09-10", "VI"],
    ["2026-09-11", "2026-09-18", "MARINA"],
    ["2026-09-19", "2026-09-25", "IKOYI"],
    ["2026-09-26", "2026-09-30", "LEKKI"],
  ];
  for (const [from, to, bk] of seg)
    for (const day of eachDay(d(from), d(to)))
      e25rows.push({
        organizationId: org.id,
        date: day,
        employeeId: EMP25.id,
        clientId: beat[bk].clientId,
        contractId: beat[bk].contractId,
        beatId: beat[bk].id,
        categoryId: cat.GUARD.id,
        shift: "DAY",
        attendanceStatus: "PRESENT",
        hoursWorked: 12,
        overtimeHours: 0,
        supervisor: "Sunday Supervisor",
        source: "SUPERVISOR",
        recordedBy: "Sunday Supervisor",
      });
  await db.workRegister.createMany({ data: e25rows });

  // Other September movements
  await mv(8, "IKOYI", "2026-09-05", "RELIEF", "Relief cover for guard on leave", "2026-09-09");
  await mv(52, "OTA", "2026-09-16", "LOCATION_TRANSFER", "Ota warehouse understaffed");
  await createMovement(ops, {
    employeeId: E(65).id,
    toBeatId: beat.SURU.id,
    movementType: "PERMANENT_TRANSFER",
    movementDate: "2026-09-20",
    effectiveDate: "2026-10-01",
    reason: "Requested transfer closer to residence",
  }); // pending
  // re-point work register for the movements above
  for (const day of eachDay(d("2026-09-05"), d("2026-09-09")))
    await db.workRegister.updateMany({
      where: { employeeId: E(8).id, date: day },
      data: {
        beatId: beat.IKOYI.id,
        clientId: beat.IKOYI.clientId,
        contractId: beat.IKOYI.contractId,
        locationMismatch: false,
      },
    });
  for (const day of eachDay(d("2026-09-16"), d("2026-09-30")))
    await db.workRegister.updateMany({
      where: { employeeId: E(52).id, date: day },
      data: {
        beatId: beat.OTA.id,
        clientId: beat.OTA.clientId,
        contractId: beat.OTA.contractId,
        locationMismatch: false,
      },
    });

  // Location exceptions (wrong-mapping controls)
  // EMP-000040 assigned to XYZ Manufacturing (Ota) but attendance recorded at Retail Client — CLIENT mismatch (red alert)
  await db.workRegister.updateMany({
    where: { employeeId: E(40).id, date: d("2026-09-15") },
    data: {
      beatId: beat.MALL_IKJ.id,
      clientId: beat.MALL_IKJ.clientId,
      contractId: beat.MALL_IKJ.contractId,
      locationMismatch: true,
    },
  });
  // EMP-000014 assigned to one ABC branch but recorded at Ikoyi — LOCATION mismatch
  const e14 = await db.deployment.findFirstOrThrow({ where: { employeeId: E(14).id } });
  const wrongBeat = e14.beatId === beat.IKOYI.id ? beat.MARINA : beat.IKOYI;
  await db.workRegister.updateMany({
    where: { employeeId: E(14).id, date: d("2026-09-12") },
    data: {
      beatId: wrongBeat.id,
      clientId: wrongBeat.clientId,
      contractId: wrongBeat.contractId,
      locationMismatch: true,
    },
  });

  // September overtime (client schedules)
  await otFor(sep.id, 25, "VI", "2026-09-04", 6, "ABC/OT/SEP/031");
  await otFor(sep.id, 25, "LEKKI", "2026-09-27", 4, "XYZ/OT/SEP/012");
  await otFor(sep.id, 3, "VI", "2026-09-12", 8, "ABC/OT/SEP/032");
  await otFor(sep.id, 30, "LEKKI", "2026-09-06", 6, "XYZ/OT/SEP/013");
  await otFor(sep.id, 95, "WARRI", "2026-09-20", 5, "IND/K9/OT/SEP/004");
  await createOvertime(ctx("PAYROLL_ADMIN"), {
    employeeId: E(45).id,
    beatId: (await db.deployment.findFirstOrThrow({ where: { employeeId: E(45).id } })).beatId,
    periodId: sep.id,
    date: "2026-09-13",
    hours: 4,
  }); // pending, no approval ref yet

  // Arrears: late salary increase for EMP-000010 relating to August
  const arr = await createArrears(ctx("PAYROLL_ADMIN"), {
    employeeId: E(10).id,
    originalPeriodId: aug.id,
    arrearsType: "LATE_SALARY_INCREASE",
    correctedMonthlyGross: 98000,
    reason: "Promotion to Senior Guard approved in October retrospective from August",
    supportingDocument: "HR/PROM/2026/118",
  });
  await approveArrears(finance, arr.id);
  await createArrears(ctx("PAYROLL_ADMIN"), {
    employeeId: E(22).id,
    originalPeriodId: aug.id,
    arrearsType: "MISSED_PAYMENT",
    originalAmount: 0,
    correctedAmount: 15000,
    reason: "Missed meal allowance correction — awaiting approval",
  });

  // Deductions (documented authority required)
  const ded = async (
    n: number,
    type: "PENALTY" | "LOAN" | "SALARY_ADVANCE" | "RECOVERY",
    amount: number,
    reason: string,
    ref: string,
    approve = true,
  ) => {
    const x = await createDeduction(ctx("PAYROLL_ADMIN"), {
      employeeId: E(n).id,
      deductionType: type,
      amount,
      periodId: sep.id,
      reason,
      authorityReference: ref,
      supportingDocument: `${ref}.pdf`,
    });
    if (approve) await approveDeduction(finance, x.id);
  };
  await ded(25, "PENALTY", 2500, "Late resumption at post (3 occurrences)", "DISC/2026/SEP/044");
  await ded(17, "LOAN", 10000, "Staff cooperative loan instalment 3 of 10", "COOP/LN/2026/0193");
  await ded(29, "SALARY_ADVANCE", 15000, "Salary advance recovery", "FIN/ADV/2026/077");
  await ded(33, "RECOVERY", 4000, "Lost uniform recovery", "OPS/KIT/2026/015");
  await ded(41, "PENALTY", 3000, "Sleeping on duty — disciplinary panel", "DISC/2026/SEP/051", false);

  const bonus = await createOtherEarning(ctx("PAYROLL_ADMIN"), {
    employeeId: E(7).id,
    periodId: sep.id,
    name: "Commendation Award",
    amount: 20000,
    taxable: true,
    reason: "Foiled attempted burglary at Victoria Island branch",
  });
  await approveOtherEarning(finance, bonus.id);

  console.log("→ September payroll first calculation (period stays OPEN for review)");
  await runPayroll(ctx("PAYROLL_ADMIN"), sep.id);

  // ─────────────── Annual leave: one approved, one awaiting the supervisor ───────────────
  console.log("→ Annual leave (10 working days, due after 12 months; supervisor approval)");
  {
    const todayD = d(iso(new Date()));
    const viDeps = await db.deployment.findMany({
      where: { organizationId: org.id, beatId: beat.VI.id, status: "ACTIVE" },
      include: { employee: true },
    });
    const eligible = viDeps
      .map((x) => x.employee)
      .filter(
        (e) =>
          e.status === "ACTIVE" &&
          e.categoryId === cat.GUARD.id &&
          e.currentBeatId === beat.VI.id &&
          leaveEligibility(e.employmentDate, todayD, 12).cycle,
      )
      .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
    // Start two weeks out, on a Monday, after the seeded work register ends.
    let start = addDays(todayD, 14);
    if (start < d("2026-10-01")) start = d("2026-10-01");
    while (start.getUTCDay() !== 1) start = addDays(start, 1);
    const asEmployee = (e: (typeof eligible)[number]): Ctx => ({
      userId: e.id,
      orgId: org.id,
      role: "EMPLOYEE",
      name: `${e.firstName} ${e.lastName}`,
      email: "",
      employeeId: e.id,
    });
    if (eligible[0]) {
      const r = await applyForLeave(asEmployee(eligible[0]), {
        startDate: iso(start),
        endDate: iso(addDays(start, 4)),
        reason: "Annual leave — family visit",
      });
      await decideLeave(ctx("SUPERVISOR"), r.id, "APPROVED");
    }
    if (eligible[1])
      await applyForLeave(asEmployee(eligible[1]), {
        startDate: iso(addDays(start, 7)),
        endDate: iso(addDays(start, 9)),
        reason: "Annual leave — wedding",
      });
  }

  // ─────────────── Employee self-service users ───────────────
  await db.user.create({
    data: {
      organizationId: org.id,
      email: "emp25@demosecurity.test",
      name: "EMP-000025 (Employee)",
      role: "EMPLOYEE",
      passwordHash: hash,
      employeeId: EMP25.id,
    },
  });

  // ─────────────── Second organization (tenancy isolation) ───────────────
  const org2 = await db.organization.create({
    data: { name: "Northern Guards Ltd", code: "NGL", address: "Kano" },
  });
  await db.user.create({
    data: {
      organizationId: org2.id,
      email: "admin@northernguards.test",
      name: "Northern Admin",
      role: "COMPANY_ADMIN",
      passwordHash: hash,
    },
  });
  await seedStatutory(org2.id);
  await ensureDefaultChart(db, org2.id);
  const ngCat = await db.employeeCategory.create({
    data: { organizationId: org2.id, code: "GUARD", name: "Security Guard" },
  });
  await db.client.create({
    data: { organizationId: org2.id, code: "NGC", name: "Northern Cement", status: "ACTIVE" },
  });
  for (let i = 1; i <= 3; i++)
    await db.employee.create({
      data: {
        organizationId: org2.id,
        employeeNumber: `EMP-${String(i).padStart(6, "0")}`,
        firstName: "Northern",
        lastName: `Guard${i}`,
        employmentDate: d("2025-01-01"),
        categoryId: ngCat.id,
      },
    });

  await seedHrDemo(org.id);
  await seedInventoryDemo(org.id);
  await seedLoanDemo(org.id);
  await seedPersonalRecordsDemo(org.id);
  await seedTrainingDemo(org.id);
  await seedAppraisalDemo(org.id);

  const counts = {
    employees: await db.employee.count({ where: { organizationId: org.id } }),
    beats: await db.beat.count({ where: { organizationId: org.id } }),
    workRegister: await db.workRegister.count({ where: { organizationId: org.id } }),
    movements: await db.staffMovement.count({ where: { organizationId: org.id } }),
  };
  console.log(`✔ Seed complete — ${JSON.stringify(counts)}`);
  console.log(`  Login: admin@demosecurity.test / ${DEMO_PASSWORD}  (see README for all roles)`);
  console.log(`  Today: ${iso(new Date())}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
