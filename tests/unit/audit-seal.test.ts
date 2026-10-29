import { describe, expect, it } from "vitest";
import {
  assertSealKey,
  auditContentHash,
  canonicalJson,
  ChainVerifier,
  chainHashOf,
  declaredFromEntries,
  GENESIS_HASH,
  nextSeal,
  redactionProof,
  type AuditRowForSeal,
  type SealRecord,
} from "@/lib/audit-seal";

/**
 * The seal on every audit row: SHA-256 of the row's canonical content, chained to the previous seal with an HMAC under a secret key.
 * Pure arithmetic: no database. Everything is invented.
 */
const KEY = "a-test-sealing-key-of-at-least-32-characters!!";
const ORG = "org-1";
const t0 = new Date("2026-11-02T09:00:00.000Z");

const row = (i: number, over: Partial<AuditRowForSeal> = {}): AuditRowForSeal => ({
  id: `a${i}`, organizationId: ORG, userId: "u1", userName: "Ada Payroll", action: "PAYROLL_APPROVE", entity: "PayrollRun", entityId: `run${i}`,
  oldValue: null, newValue: { status: "APPROVED", total: 1000 + i }, reason: null, metadata: { role: "FINANCE", ip: "203.0.113.5" },
  createdAt: new Date(t0.getTime() + i * 1000), ...over,
});

function sealAll(rows: AuditRowForSeal[], key = KEY): SealRecord[] {
  const out: SealRecord[] = [];
  for (const r of rows) out.push(nextSeal(key, ORG, out.at(-1) ? { seq: out.at(-1)!.seq, chainHash: out.at(-1)!.chainHash } : null, r));
  return out;
}
const byId = (rows: AuditRowForSeal[]) => new Map(rows.map((r) => [r.id, r]));
const verify = (seals: SealRecord[], rows: AuditRowForSeal[], key = KEY, declared = new Map<string, ReadonlySet<string>>()) => {
  const v = new ChainVerifier(key, ORG, declared);
  v.feed(seals, byId(rows));
  return v.findings();
};
const rows5 = [1, 2, 3, 4, 5].map((i) => row(i));

describe("the canonical form of a row", () => {
  it("does not depend on the order keys were written in, nor on undefined versus null", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe(canonicalJson({ b: null }));
    expect(auditContentHash(row(1, { oldValue: null }))).toBe(auditContentHash({ ...row(1), oldValue: undefined as never }));
  });
  it("gives a different hash when any field changes, by even one character", () => {
    const base = auditContentHash(row(1));
    for (const change of [{ userName: "Ada Payroll " }, { action: "PAYROLL_APPROVED" }, { entityId: "run2" }, { reason: "x" }, { newValue: { status: "APPROVED", total: 1002 } }, { metadata: { role: "FINANCE", ip: "203.0.113.6" } }, { createdAt: new Date(t0.getTime() + 1001) }, { organizationId: "org-2" }])
      expect(auditContentHash(row(1, change as never)), JSON.stringify(change)).not.toBe(base);
  });
  it("is a 64-character hex string", () => expect(auditContentHash(row(1))).toMatch(/^[0-9a-f]{64}$/));
});

describe("the chain", () => {
  it("starts from the fixed zero value, numbers entries 1, 2, 3 and links each to the one before", () => {
    const seals = sealAll(rows5);
    expect(seals.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(seals[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < seals.length; i++) expect(seals[i].prevHash).toBe(seals[i - 1].chainHash);
  });
  it("needs the key: the same rows sealed with another key give different seals", () => {
    expect(sealAll(rows5, "another-sealing-key-of-at-least-32-characters")[0].chainHash).not.toBe(sealAll(rows5)[0].chainHash);
  });
  it("is tied to its organization, so a chain cannot be moved to another one", () => {
    const a = chainHashOf(KEY, { prevHash: GENESIS_HASH, contentHash: "c".repeat(64), seq: 1, organizationId: "org-1" });
    const b = chainHashOf(KEY, { prevHash: GENESIS_HASH, contentHash: "c".repeat(64), seq: 1, organizationId: "org-2" });
    expect(a).not.toBe(b);
  });
});

describe("checking a chain", () => {
  it("finds nothing wrong with an untouched log, and reports its head", () => {
    const v = new ChainVerifier(KEY, ORG);
    const seals = sealAll(rows5);
    v.feed(seals, byId(rows5));
    expect(v.findings()).toEqual([]);
    expect(v.head()).toEqual({ seq: 5, chainHash: seals[4].chainHash });
  });
  it("works the same whether the seals arrive in one batch or several", () => {
    const seals = sealAll(rows5);
    const v = new ChainVerifier(KEY, ORG);
    v.feed(seals.slice(0, 2), byId(rows5));
    v.feed(seals.slice(2), byId(rows5));
    expect(v.findings()).toEqual([]);
  });

  it("MODIFIED: names a row whose content changed", () => {
    const tampered = rows5.map((r) => (r.id === "a3" ? { ...r, newValue: { status: "APPROVED", total: 9_999_999 } } : r));
    const f = verify(sealAll(rows5), tampered);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "MODIFIED", seq: 3, auditLogId: "a3" });
  });
  it("MISSING_ROW: names a row that was removed", () => {
    const f = verify(sealAll(rows5), rows5.filter((r) => r.id !== "a2"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "MISSING_ROW", seq: 2, auditLogId: "a2" });
  });
  it("BAD_SEAL: a seal whose stored hash is not what the key would give", () => {
    const seals = sealAll(rows5);
    seals[2] = { ...seals[2], chainHash: "f".repeat(64) };
    const f = verify(seals, rows5);
    expect(f.map((x) => x.kind)).toEqual(["BAD_SEAL", "BROKEN_LINK"]); // and the next entry no longer follows it
    expect(f.map((x) => x.seq)).toEqual([3, 4]);
  });
  it("SEQ_GAP and BROKEN_LINK: a seal taken out of the middle", () => {
    const seals = sealAll(rows5);
    const f = verify(seals.filter((s) => s.seq !== 3), rows5);
    expect(f.map((x) => x.kind).sort()).toEqual(["BROKEN_LINK", "SEQ_GAP"]);
  });
  it("is not fooled by rewriting the content hash and the seal together WITHOUT the key", () => {
    const tampered = rows5.map((r) => (r.id === "a3" ? { ...r, newValue: { status: "APPROVED", total: 1 } } : r));
    const seals = sealAll(rows5);
    seals[2] = { ...seals[2], contentHash: auditContentHash(tampered[2]) }; // attacker fixes the content hash but cannot recompute the keyed seal
    expect(verify(seals, tampered).map((x) => x.kind)).toEqual(["BAD_SEAL"]);
  });
  it("is fooled by someone who has the key and rebuilds the whole chain (the known limit; weekly copies of the head outside the system are the answer)", () => {
    const tampered = rows5.map((r) => (r.id === "a3" ? { ...r, newValue: { status: "APPROVED", total: 1 } } : r));
    expect(verify(sealAll(tampered), tampered)).toEqual([]);
  });
  it("fails every entry when checked with the wrong key", () => {
    const f = verify(sealAll(rows5), rows5, "a-different-key-of-at-least-32-characters-long");
    expect(f.filter((x) => x.kind === "BAD_SEAL")).toHaveLength(5);
  });
  it("BACKDATED: a row sealed later whose time is long before the entries already sealed", () => {
    const late = row(6, { createdAt: new Date(t0.getTime() - 3_600_000) }); // an hour before the first
    const all = [...rows5, late];
    const f = verify(sealAll(all), all);
    expect(f.map((x) => x.kind)).toEqual(["BACKDATED"]);
    expect(f[0].auditLogId).toBe("a6");
  });
  it("accepts a row that committed a little late (within the settling time), which is normal", () => {
    const slightlyLate = row(6, { createdAt: new Date(t0.getTime() + 5 * 1000 - 2 * 60_000) });
    const all = [...rows5, slightlyLate];
    expect(verify(sealAll(all), all)).toEqual([]);
  });
});

describe("a declared redaction", () => {
  const redacted = (r: AuditRowForSeal): AuditRowForSeal => ({ ...r, newValue: { status: "APPROVED", account: "••••6789" } });
  it("is accepted when the audit log itself declares the new content hash of that row", () => {
    const seals = sealAll(rows5);
    const now = rows5.map((r) => (r.id === "a4" ? redacted(r) : r));
    const declared = new Map<string, ReadonlySet<string>>([["a4", new Set([auditContentHash(redacted(rows5[3]))])]]);
    expect(verify(seals, now, KEY, declared)).toEqual([]);
  });
  it("is not accepted when nothing declares it, or the declared hash is for different content", () => {
    const seals = sealAll(rows5);
    const now = rows5.map((r) => (r.id === "a4" ? redacted(r) : r));
    expect(verify(seals, now).map((x) => x.kind)).toEqual(["MODIFIED"]);
    const wrong = new Map<string, ReadonlySet<string>>([["a4", new Set(["0".repeat(64)])]]);
    expect(verify(seals, now, KEY, wrong).map((x) => x.kind)).toEqual(["MODIFIED"]);
  });
});

describe("the sealing key", () => {
  it("must be there and long enough, and the error never contains the key", () => {
    expect(() => assertSealKey(undefined)).toThrow(/AUDIT_SEAL_KEY/);
    expect(() => assertSealKey("short-key")).toThrow(/32/);
    try {
      assertSealKey("short-key");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("short-key");
    }
    expect(assertSealKey(KEY)).toBe(KEY);
  });
});

describe("declarations of a redaction carry a proof only the sealing key can make", () => {
  const hash = "a".repeat(64);
  const entry = (proof: string) => ({ redacted: [{ id: "a4", contentHash: hash, proof }] });
  it("accepts a declaration with the right proof", () => {
    const m = declaredFromEntries(KEY, ORG, [entry(redactionProof(KEY, ORG, "a4", hash))]);
    expect(m.get("a4")?.has(hash)).toBe(true);
  });
  it("ignores one with a wrong proof, a proof from another key or organization, or no proof, and tolerates junk", () => {
    expect(declaredFromEntries(KEY, ORG, [entry("f".repeat(64))]).size).toBe(0);
    expect(declaredFromEntries(KEY, ORG, [entry(redactionProof("another-key-of-at-least-32-characters-long-x", ORG, "a4", hash))]).size).toBe(0);
    expect(declaredFromEntries(KEY, ORG, [entry(redactionProof(KEY, "org-2", "a4", hash))]).size).toBe(0);
    expect(declaredFromEntries(KEY, ORG, [{ redacted: [{ id: "a4", contentHash: hash }] }, null, "x", { redacted: "no" }, {}]).size).toBe(0);
  });
  it("cannot be used to legitimise a different edit of the same row", () => {
    const tampered = { ...rows5[3], newValue: { status: "APPROVED", total: 1 } };
    const declared = declaredFromEntries(KEY, ORG, [entry(redactionProof(KEY, ORG, "a4", hash))]); // proof is for another content hash
    expect(verify(sealAll(rows5), rows5.map((r) => (r.id === "a4" ? tampered : r)), KEY, declared).map((x) => x.kind)).toEqual(["MODIFIED"]);
  });
});
