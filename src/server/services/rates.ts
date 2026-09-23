import { isEffective } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import type { RateInfo, WorkDay } from "@/lib/payroll/engine";
import { splitAgreedRate, type StructureDef } from "@/lib/payroll/structure";
import type { Tx } from "./_base";
import { toStructureDef } from "./structures";

/**
 * Loads everything needed to resolve the applicable rate for any (contract, category, date)
 * and employee pay-rate overrides. Effective dating is respected: June payroll uses June rates.
 */
export async function loadRateBook(
  tx: Tx,
  orgId: string,
  periodStart: Date,
  periodEnd: Date,
  defaultSharePct: number,
) {
  const [rates, contracts, structures, payRates] = await Promise.all([
    tx.contractRate.findMany({
      where: {
        organizationId: orgId,
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
    }),
    tx.contract.findMany({ where: { organizationId: orgId } }),
    tx.salaryStructure.findMany({ where: { organizationId: orgId }, include: { components: true } }),
    tx.employeePayRate.findMany({
      where: {
        organizationId: orgId,
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
    }),
  ]);
  const structMap = new Map<string, StructureDef>(structures.map((s) => [s.id, toStructureDef(s)]));
  const structByCode = new Map<string, StructureDef>(structures.map((s) => [s.code, toStructureDef(s)]));
  const defaultStructure = structures.find((s) => s.isDefault);
  const contractMap = new Map(contracts.map((c) => [c.id, c]));

  function contractRate(contractId: string | null, categoryId: string, date: Date) {
    if (!contractId) return null;
    return (
      rates
        .filter(
          (r) =>
            r.contractId === contractId &&
            r.categoryId === categoryId &&
            isEffective(date, r.effectiveFrom, r.effectiveTo),
        )
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
    );
  }

  function employeePayRate(employeeId: string, date: Date) {
    return (
      payRates
        .filter((r) => r.employeeId === employeeId && isEffective(date, r.effectiveFrom, r.effectiveTo))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
    );
  }

  function resolve(
    employeeId: string,
    day: Pick<WorkDay, "contractId" | "categoryId" | "date">,
  ): RateInfo | null {
    const cr = contractRate(day.contractId, day.categoryId, day.date);
    const contract = day.contractId ? contractMap.get(day.contractId) : undefined;
    const pr = employeePayRate(employeeId, day.date);
    const share =
      cr?.operativeSharePct != null
        ? num(cr.operativeSharePct)
        : contract
          ? num(contract.operativeSharePct)
          : defaultSharePct;
    if (pr) {
      const structure =
        (pr.structureCode ? structByCode.get(pr.structureCode) : undefined) ??
        (cr ? structMap.get(cr.salaryStructureId) : undefined) ??
        (defaultStructure ? structMap.get(defaultStructure.id) : undefined);
      if (!structure) return null;
      return {
        key: `PR:${pr.id}:${structure.id}`,
        source: "EMPLOYEE_PAY_RATE",
        agreedRate: cr ? num(cr.agreedRate) : null,
        operativeSharePct: cr ? share : null,
        monthlyGross: round2(num(pr.monthlyGross)),
        structure,
      };
    }
    if (!cr) return null;
    const structure = structMap.get(cr.salaryStructureId);
    if (!structure) return null;
    const { operativeGross } = splitAgreedRate(num(cr.agreedRate), share);
    return {
      key: `CR:${cr.id}`,
      source: "CONTRACT_RATE",
      agreedRate: num(cr.agreedRate),
      operativeSharePct: share,
      monthlyGross: operativeGross,
      structure,
    };
  }

  /** Business line (guarding / outsourcing) of a contract — null for no contract (back-office pay). */
  function businessLineOf(contractId: string | null): "GUARDING" | "OUTSOURCING" | null {
    if (!contractId) return null;
    return contractMap.get(contractId)?.businessLine ?? null;
  }

  return {
    resolve,
    contractRate,
    employeePayRate,
    businessLineOf,
    defaultStructure: defaultStructure ? structMap.get(defaultStructure.id) : undefined,
  };
}
