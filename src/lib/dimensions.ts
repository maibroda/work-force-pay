/**
 * Accounting dimensions: who and what a ledger line is for, beyond its account. Pure rules, no database.
 *
 * The account says what kind of thing happened (revenue, labour cost, a receivable); the dimensions say for whom and
 * where: which client, contract, beat, cost centre, department, employee, asset, region, branch, profit centre or
 * project. Reports slice the ledger by them. A dimension is set when the line is posted and never changed afterwards.
 *
 * Company is the organization itself (every line already belongs to one). Revenue type and expense type are the
 * account's category, not a separate dimension.
 */

/** `relation` is the name of the line's relation to the master record, for queries that include it. */
export const DIMENSIONS = [
  { key: "CLIENT", column: "clientId", relation: "client", label: "Client" },
  { key: "CONTRACT", column: "contractId", relation: "contract", label: "Contract" },
  { key: "BEAT", column: "beatId", relation: "beat", label: "Beat / location" },
  { key: "COST_CENTER", column: "costCenterId", relation: "costCenter", label: "Cost centre" },
  { key: "DEPARTMENT", column: "departmentId", relation: "department", label: "Department" },
  { key: "EMPLOYEE", column: "employeeId", relation: "employee", label: "Employee" },
  { key: "ASSET", column: "fixedAssetId", relation: "fixedAsset", label: "Asset" },
  { key: "REGION", column: "regionId", relation: "region", label: "Region" },
  { key: "BRANCH", column: "branchId", relation: "branch", label: "Branch" },
  { key: "PROFIT_CENTRE", column: "profitCentreId", relation: "profitCentre", label: "Profit centre" },
  { key: "PROJECT", column: "projectId", relation: "project", label: "Project" },
] as const;

export type DimensionKey = (typeof DIMENSIONS)[number]["key"];
export type DimensionColumn = (typeof DIMENSIONS)[number]["column"];
export type LineDimensions = Partial<Record<DimensionColumn, string | null | undefined>>;

export const DIMENSION_KEYS: string[] = DIMENSIONS.map((d) => d.key);
export const DIMENSION_COLUMNS: DimensionColumn[] = DIMENSIONS.map((d) => d.column);

export const dimensionByKey = (key: string) => DIMENSIONS.find((d) => d.key === key);
export const dimensionByColumn = (column: string) => DIMENSIONS.find((d) => d.column === column);

/** Only the dimensions that actually carry a value, as a plain object ready to store. */
export function cleanDimensions(d: LineDimensions | undefined): Partial<Record<DimensionColumn, string>> {
  const out: Partial<Record<DimensionColumn, string>> = {};
  if (!d) return out;
  for (const col of DIMENSION_COLUMNS) {
    const v = d[col];
    if (typeof v === "string" && v.trim()) out[col] = v;
  }
  return out;
}

/** The dimensions an account requires that a line doesn't carry. */
export function missingRequired(required: readonly string[], dims: LineDimensions | undefined): DimensionKey[] {
  const have = cleanDimensions(dims);
  return DIMENSIONS.filter((d) => required.includes(d.key) && !have[d.column]).map((d) => d.key);
}

/** Problems with a list of required-dimension keys (unknown names), as plain sentences. */
export function invalidRequired(keys: readonly string[]): string[] {
  return keys.filter((k) => !DIMENSION_KEYS.includes(k)).map((k) => `${k} isn't an accounting dimension.`);
}
