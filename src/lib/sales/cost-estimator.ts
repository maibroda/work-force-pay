/**
 * What one guard costs the company in a month, for pricing a quote. It does NOT work out employer costs itself: it runs the real payroll engine on a
 * synthetic full month for one guard, so the pension (10% of the pensionable components, Basic, Housing and Transport in the standard structure), ITF and
 * NSITF (on gross), and every other employer add-on come out exactly as payroll would work them, with the same rules, order and rounding. Nothing is saved
 * and nothing in payroll changes. The rules passed in are the ones in force on the quote date (the caller loads them); this function reads nothing.
 *
 * The guard's monthly gross is the bill rate times the operative share (70% by default; a quote line may carry its own). The cost to the company is that
 * gross plus the employer's pension and add-on costs, as payroll's own "employer cost".
 */
import { addKobo, koboFromNaira, koboToString, subKobo, type Kobo } from "../money-exact";
import { calculateEmployeePayroll, type BusinessLine, type EmployerCostRuleInput, type RateInfo, type WorkDay } from "../payroll/engine";
import { splitAgreedRate, type StructureDef } from "../payroll/structure";
import type { TaxRuleDef } from "../payroll/paye";

export type { BusinessLine };

export interface EstimateInput {
  structure: StructureDef;
  /** What the client pays for one guard for a month, in naira (at most two decimals). */
  billRatePerHead: number | string;
  /** The share of the bill rate paid to the guard as gross, in percent. */
  operativeSharePct: number;
  businessLine: BusinessLine;
  pension: { employeeRate: number; employerRate: number; version: string };
  employerCostRule: EmployerCostRuleInput;
}

export interface HeadCost {
  billPerHead: string;
  /** The guard's monthly gross. */
  gross: string;
  /** The part of the bill rate that is not the guard's gross (the company's share). */
  managementShare: string;
  pensionBase: string;
  employerPension: string;
  addOns: { itf: string; nsitf: string; nhfMedical: string; insurance: string; uniformKits: string; recruitmentTraining: string; leaveReliever: string; outsourcingLeaveAllowance: string };
  /** Employer pension plus every add-on. */
  employerCosts: string;
  /** Gross plus employer costs: what one guard costs the company a month. */
  costPerHead: string;
  /** Bill rate minus cost. */
  marginPerHead: string;
}

// PAYE does not touch an employer cost, so the estimate runs with an empty tax table instead of needing one.
const NO_TAX: TaxRuleDef = { code: "ESTIMATE", version: "none", bands: [{ lowerBound: 0, upperBound: null, rate: 0 }], reliefs: [], exemptions: [] };

const k = (n: number): string => koboToString(koboFromNaira(n));

export function estimateHeadCost(input: EstimateInput): HeadCost {
  const bill = Number(input.billRatePerHead);
  if (!Number.isFinite(bill) || bill <= 0) throw new Error("The bill rate must be an amount above zero.");
  const billKobo: Kobo = koboFromNaira(bill, "The bill rate");
  const gross = splitAgreedRate(bill, input.operativeSharePct).operativeGross;
  const days: WorkDay[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, i + 1)),
    clientId: "QUOTE",
    clientName: "Quote",
    contractId: "QUOTE",
    beatId: "QUOTE",
    beatName: "Quote",
    categoryId: "QUOTE",
    status: "PRESENT",
    overtimeHours: 0,
  }));
  const rate: RateInfo = { key: "quote", source: "CONTRACT_RATE", agreedRate: bill, operativeSharePct: input.operativeSharePct, monthlyGross: gross, structure: input.structure };
  const r = calculateEmployeePayroll({
    basisDays: 30,
    days,
    resolveRate: () => rate,
    businessLineFor: () => input.businessLine,
    employerCostRule: input.employerCostRule,
    pension: input.pension,
    taxRule: NO_TAX,
  });
  const employerCosts = addKobo(koboFromNaira(r.employerPension), koboFromNaira(r.totalEmployerAddOns));
  return {
    billPerHead: koboToString(billKobo),
    gross: k(r.earnedGross),
    managementShare: k(r.managementShare),
    pensionBase: k(r.pensionBase),
    employerPension: k(r.employerPension),
    addOns: {
      itf: k(r.itfAmount),
      nsitf: k(r.nsitfAmount),
      nhfMedical: k(r.nhfMedicalAmount),
      insurance: k(r.insuranceAmount),
      uniformKits: k(r.uniformKitsAmount),
      recruitmentTraining: k(r.recruitmentTrainingAmount),
      leaveReliever: k(r.leaveRelieverAmount),
      outsourcingLeaveAllowance: k(r.outsourcingLeaveAllowanceAmount),
    },
    employerCosts: koboToString(employerCosts),
    costPerHead: k(r.employerCost),
    marginPerHead: koboToString(subKobo(billKobo, koboFromNaira(r.employerCost))),
  };
}
