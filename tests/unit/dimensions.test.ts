import { describe, expect, it } from "vitest";
import { cleanDimensions, DIMENSION_COLUMNS, DIMENSION_KEYS, DIMENSIONS, dimensionByColumn, dimensionByKey, invalidRequired, missingRequired } from "@/lib/dimensions";
import { splitRevenue } from "@/server/services/gl-posting";

describe("the dimension table", () => {
  it("has the eleven dimensions with unique keys, columns and relations", () => {
    expect(DIMENSIONS).toHaveLength(11);
    for (const field of ["key", "column", "relation", "label"] as const) expect(new Set(DIMENSIONS.map((d) => d[field])).size, field).toBe(11);
  });
  it("looks up by key and by column", () => {
    expect(dimensionByKey("COST_CENTER")?.column).toBe("costCenterId");
    expect(dimensionByColumn("fixedAssetId")?.key).toBe("ASSET");
    expect(dimensionByKey("NOPE")).toBeUndefined();
    expect(DIMENSION_KEYS).toContain("PROFIT_CENTRE");
    expect(DIMENSION_COLUMNS).toContain("projectId");
  });
});

describe("cleanDimensions", () => {
  it("keeps only the dimensions that carry a value", () => {
    expect(cleanDimensions({ clientId: "c1", contractId: null, beatId: undefined, costCenterId: "", employeeId: "  " })).toEqual({ clientId: "c1" });
    expect(cleanDimensions(undefined)).toEqual({});
  });
  it("ignores anything that isn't a dimension", () => {
    expect(cleanDimensions({ clientId: "c1", nonsense: "x" } as never)).toEqual({ clientId: "c1" });
  });
});

describe("missingRequired", () => {
  it("lists the required dimensions a line lacks, in table order", () => {
    expect(missingRequired(["CONTRACT", "CLIENT"], { clientId: "c1" })).toEqual(["CONTRACT"]);
    expect(missingRequired(["CONTRACT", "CLIENT"], {})).toEqual(["CLIENT", "CONTRACT"]);
    expect(missingRequired([], {})).toEqual([]);
    expect(missingRequired(["CLIENT"], { clientId: "c1" })).toEqual([]);
  });
  it("treats an empty value as missing", () => {
    expect(missingRequired(["CLIENT"], { clientId: "" })).toEqual(["CLIENT"]);
  });
});

describe("invalidRequired", () => {
  it("names unknown dimensions", () => {
    expect(invalidRequired(["CLIENT", "COLOUR"])).toEqual(["COLOUR isn't an accounting dimension."]);
    expect(invalidRequired(["CLIENT", "PROJECT"])).toEqual([]);
  });
});

describe("splitRevenue", () => {
  it("groups invoice lines by contract and beat and always sums to the subtotal", () => {
    const rows = splitRevenue(
      [
        { contractId: "k1", beatId: "b1", amount: 100.1 },
        { contractId: "k1", beatId: "b1", amount: 50.2 },
        { contractId: "k1", beatId: "b2", amount: 200 },
        { contractId: "k2", beatId: null, amount: 75.55 },
      ],
      425.85,
    );
    expect(rows).toEqual([
      { contractId: "k1", beatId: "b1", amount: 150.3 },
      { contractId: "k1", beatId: "b2", amount: 200 },
      { contractId: "k2", beatId: null, amount: 75.55 },
    ]);
    expect(rows.reduce((a, r) => a + r.amount, 0)).toBeCloseTo(425.85, 2);
  });

  it("puts a rounding difference on the first group so the total is exact", () => {
    const rows = splitRevenue([{ contractId: "k1", amount: 100 }, { contractId: "k2", amount: 200 }], 300.03);
    expect(rows.reduce((a, r) => Math.round((a + r.amount) * 100) / 100, 0)).toBe(300.03);
    expect(rows[0].amount).toBe(100.03);
  });

  it("falls back to one undimensioned line when there are no invoice lines, or only zero lines", () => {
    expect(splitRevenue(undefined, 500)).toEqual([{ contractId: null, beatId: null, amount: 500 }]);
    expect(splitRevenue([], 500)).toEqual([{ contractId: null, beatId: null, amount: 500 }]);
    expect(splitRevenue([{ contractId: "k1", amount: 0 }], 500)).toEqual([{ contractId: null, beatId: null, amount: 500 }]);
  });

  it("copes with decimal strings as the database returns them", () => {
    expect(splitRevenue([{ contractId: "k1", amount: "1234.50" }], 1234.5)).toEqual([{ contractId: "k1", beatId: null, amount: 1234.5 }]);
  });
});
