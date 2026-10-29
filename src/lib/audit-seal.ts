import { createHash, createHmac } from "node:crypto";

/**
 * Seals for the audit log (rule 5: tamper-evident). Pure: no database, no clock, no environment. docs/plans/tamper-evident-audit-log.md.
 *
 * Every audit row gets a seal: a SHA-256 hash of the row's canonical content (`contentHash`), chained to the previous seal of the same organization by an
 * HMAC under a secret key (`chainHash`). Changing, removing, forging or back-dating a row, or cutting a seal out, makes the check name the entry.
 * This is DETECTION, not prevention, and someone who holds both the database and the key could rebuild the chain; the weekly copy of the chain head
 * sent outside the system is what exposes that.
 */
export const GENESIS_HASH = "0".repeat(64);
/** An audit row is sealed once it is this old, so transactions still in flight have committed. */
export const SETTLE_SECONDS = 60;
/** A row may commit a little after a newer one; more than this earlier than an entry already sealed counts as back-dated. */
export const BACKDATE_TOLERANCE_MS = 5 * 60_000;
/** Rows still unsealed after this long mean the sealing job is not running. */
export const STALLED_MINUTES = 10;
/** A seal made this long after its row was written is marked "sealed late" (the log's history before sealing began). */
export const LATE_SEAL_MINUTES = 15;
export const MIN_KEY_LENGTH = 32;

/** Stable text for any JSON-like value: keys sorted, undefined treated as null, dates as ISO text, no spaces. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface AuditRowForSeal {
  id: string;
  organizationId: string;
  userId: string | null;
  userName: string;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  metadata: unknown;
  createdAt: Date;
}

/** SHA-256 (hex) of everything an audit row says. */
export function auditContentHash(r: AuditRowForSeal): string {
  const body = canonicalJson([r.id, r.organizationId, r.userId, r.userName, r.action, r.entity, r.entityId, r.oldValue, r.newValue, r.reason, r.metadata, r.createdAt]);
  return createHash("sha256").update(body).digest("hex");
}

/** HMAC-SHA-256 (hex) over the previous seal, this row's content hash, its number and its organization. */
export function chainHashOf(key: string, p: { prevHash: string; contentHash: string; seq: number; organizationId: string }): string {
  return createHmac("sha256", key).update(`${p.prevHash}|${p.contentHash}|${p.seq}|${p.organizationId}`).digest("hex");
}

/** The key, or an error that says what is wrong WITHOUT repeating the key. */
export function assertSealKey(key: string | undefined): string {
  if (!key) throw new Error("AUDIT_SEAL_KEY is not set, so the audit log cannot be sealed or checked.");
  if (key.length < MIN_KEY_LENGTH) throw new Error(`AUDIT_SEAL_KEY must be at least ${MIN_KEY_LENGTH} characters.`);
  return key;
}

export interface SealRecord {
  seq: number;
  auditLogId: string;
  contentHash: string;
  prevHash: string;
  chainHash: string;
}

/** The seal for the next row of an organization, given the last seal (null for the first). */
export function nextSeal(key: string, organizationId: string, last: { seq: number; chainHash: string } | null, row: AuditRowForSeal): SealRecord {
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.chainHash ?? GENESIS_HASH;
  const contentHash = auditContentHash(row);
  return { seq, auditLogId: row.id, contentHash, prevHash, chainHash: chainHashOf(key, { prevHash, contentHash, seq, organizationId }) };
}

export type FindingKind = "MODIFIED" | "MISSING_ROW" | "BAD_SEAL" | "BROKEN_LINK" | "SEQ_GAP" | "BACKDATED";
export interface Finding {
  kind: FindingKind;
  seq: number;
  auditLogId: string;
  detail: string;
}

/**
 * Checks one organization's seals, in order, in as many batches as needed (it keeps its place between batches).
 * `declared` maps an audit row id to the content hashes an AUDIT_REDACTION entry declared for it: a row changed on purpose and recorded as such.
 */
export class ChainVerifier {
  private lastSeq = 0;
  private lastHash = GENESIS_HASH;
  private lastCreated: Date | null = null;
  private found: Finding[] = [];
  private count = 0;

  constructor(
    private readonly key: string,
    private readonly organizationId: string,
    private readonly declared: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  ) {}

  feed(seals: readonly SealRecord[], rows: ReadonlyMap<string, AuditRowForSeal>): void {
    for (const s of seals) {
      this.count += 1;
      const add = (kind: FindingKind, detail: string) => this.found.push({ kind, seq: s.seq, auditLogId: s.auditLogId, detail });
      if (s.seq !== this.lastSeq + 1) add("SEQ_GAP", `Expected entry ${this.lastSeq + 1}, found ${s.seq}.`);
      if (s.prevHash !== this.lastHash) add("BROKEN_LINK", "This seal does not follow the one before it.");
      const expected = chainHashOf(this.key, { prevHash: s.prevHash, contentHash: s.contentHash, seq: s.seq, organizationId: this.organizationId });
      if (expected !== s.chainHash) add("BAD_SEAL", "The seal is not what the sealing key gives for these values.");
      const row = rows.get(s.auditLogId);
      if (!row) add("MISSING_ROW", "The audit entry this seal covers is gone.");
      else {
        const now = auditContentHash(row);
        if (now !== s.contentHash && !this.declared.get(s.auditLogId)?.has(now)) add("MODIFIED", "The audit entry no longer says what it said when it was sealed.");
        if (this.lastCreated && row.createdAt.getTime() < this.lastCreated.getTime() - BACKDATE_TOLERANCE_MS) add("BACKDATED", "The entry is dated well before entries sealed earlier.");
        if (!this.lastCreated || row.createdAt > this.lastCreated) this.lastCreated = row.createdAt;
      }
      this.lastSeq = s.seq;
      this.lastHash = s.chainHash;
    }
  }

  findings(): Finding[] {
    return [...this.found];
  }
  /** The last entry seen: the "head" copied outside the system each week. */
  head(): { seq: number; chainHash: string } {
    return { seq: this.lastSeq, chainHash: this.lastHash };
  }
  checked(): number {
    return this.count;
  }
}

/** The proof written with a declared redaction: only someone holding the sealing key can produce it, so an inserted entry cannot "declare" an edit legitimate. */
export function redactionProof(key: string, organizationId: string, auditLogId: string, contentHash: string): string {
  return createHmac("sha256", key).update(`redact|${organizationId}|${auditLogId}|${contentHash}`).digest("hex");
}

/**
 * The redactions an organization's AUDIT_REDACTION entries declare, as `ChainVerifier` wants them (row id to accepted content hashes).
 * `entries` are the entries' newValue objects: `{ redacted: [{ id, contentHash, proof }] }`. A declaration with a wrong or missing proof is ignored.
 */
export function declaredFromEntries(key: string, organizationId: string, entries: readonly unknown[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const e of entries) {
    const list = (e as { redacted?: unknown } | null)?.redacted;
    if (!Array.isArray(list)) continue;
    for (const item of list as Array<{ id?: unknown; contentHash?: unknown; proof?: unknown }>) {
      if (typeof item?.id !== "string" || typeof item.contentHash !== "string" || typeof item.proof !== "string") continue;
      if (redactionProof(key, organizationId, item.id, item.contentHash) !== item.proof) continue;
      const set = out.get(item.id) ?? new Set<string>();
      set.add(item.contentHash);
      out.set(item.id, set);
    }
  }
  return out;
}
