import { describe, expect, it } from "vitest";
import { certificateKey, reconcileCertificates, uncertified } from "@/lib/certificates";

describe("certificateKey", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(certificateKey("WHT-77")).toBe("WHT77");
    expect(certificateKey(" wht 77 ")).toBe("WHT77");
    expect(certificateKey("Wht/77.A")).toBe("WHT77A");
    expect(certificateKey("--")).toBe("");
  });
});

describe("reconcileCertificates", () => {
  const w = (reference: string, amount: number, clientId = "c1") => ({ clientId, reference, amount, source: "Receipt RCT-1" });
  const c = (certificateNumber: string, amount: number, clientId = "c1", id = certificateNumber) => ({ id, clientId, certificateNumber, amount });

  it("matches on client and number, adding up what was withheld under one number", () => {
    const rows = reconcileCertificates([w("wht 1", 100), w("WHT-1", 50), w("WHT-1", 70, "c2")], [c("WHT-1", 150)]);
    expect(rows.map((r) => [r.clientId, r.withheld, r.certified, r.status])).toEqual(
      expect.arrayContaining([["c1", 150, 150, "MATCHED"], ["c2", 70, 0, "MISSING"]]),
    );
    expect(rows).toHaveLength(2); // the same number for another client is a different certificate
  });

  it("says short, over, missing and not recorded", () => {
    const rows = reconcileCertificates([w("A", 100), w("B", 100), w("C", 100)], [c("A", 60), c("B", 130), c("D", 40)]);
    const by = Object.fromEntries(rows.map((r) => [r.label, r.status]));
    expect(by).toEqual({ A: "CERT_SHORT", B: "CERT_EXCEEDS", C: "MISSING", D: "NOT_RECORDED" });
  });

  it("adds up several certificates under one number, and takes the printed number as the label", () => {
    const rows = reconcileCertificates([w("wht-2", 100)], [c("WHT-2", 60, "c1", "x"), c("WHT 2", 40, "c1", "y")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ withheld: 100, certified: 100, status: "MATCHED", certificateIds: ["x", "y"] });
  });

  it("totals the tax with no certificate behind it, to the kobo", () => {
    const rows = reconcileCertificates([w("A", 100.1), w("B", 100), w("C", 100)], [c("A", 60.05), c("B", 130), c("D", 40)]);
    expect(uncertified(rows)).toBe(140.05); // 40.05 short on A, none on B, all 100 of C
  });
});
