/**
 * Electronic employee documents: the categories and standard types, the checks every uploaded file must pass, and how a document's status shows.
 * Pure rules, no database and no file system (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md).
 *
 * The categories are fixed. The TYPES inside them are data (a company can add or switch off types without code); STANDARD_TYPES is what each company starts with.
 * Every upload is checked on the server by checkUpload: the extension, the size, and the file's own first bytes, which must agree.
 */

export const DOCUMENT_CATEGORIES = ["EMPLOYMENT", "IDENTIFICATION", "EDUCATION_PROFESSIONAL", "COMPLIANCE", "MEDICAL", "STATUTORY", "EXIT"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  EMPLOYMENT: "Employment documents",
  IDENTIFICATION: "Identification documents",
  EDUCATION_PROFESSIONAL: "Educational and professional documents",
  COMPLIANCE: "Compliance documents",
  MEDICAL: "Medical documents",
  STATUTORY: "Statutory documents",
  EXIT: "Exit documents",
};

export const DOCUMENT_STATUSES = ["PENDING", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "ARCHIVED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const STATUS_LABELS: Record<DocumentStatus | "REFERENCE_ONLY", string> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
  REFERENCE_ONLY: "Reference only",
};

export interface StandardType {
  code: string;
  name: string;
  category: DocumentCategory;
  /** Has an expiry date worth tracking (identification, licences, fitness certificates). */
  hasExpiry: boolean;
  /** Identification and medical records need the document-sensitive permission to open. */
  sensitive: boolean;
}

const t = (category: DocumentCategory, code: string, name: string, hasExpiry = false): StandardType => ({
  code,
  name,
  category,
  hasExpiry,
  sensitive: category === "IDENTIFICATION" || category === "MEDICAL",
});

/** What every company starts with; an administrator can add types, rename them, or switch them off. */
export const STANDARD_TYPES: StandardType[] = [
  t("EMPLOYMENT", "OFFER_LETTER", "Offer letter"),
  t("EMPLOYMENT", "APPOINTMENT_LETTER", "Appointment letter"),
  t("EMPLOYMENT", "EMPLOYMENT_CONTRACT", "Employment contract"),
  t("EMPLOYMENT", "CONFIRMATION_LETTER", "Confirmation letter"),
  t("EMPLOYMENT", "PROMOTION_LETTER", "Promotion letter"),
  t("EMPLOYMENT", "TRANSFER_LETTER", "Transfer letter"),
  t("EMPLOYMENT", "RESIGNATION_LETTER", "Resignation letter"),
  t("EMPLOYMENT", "TERMINATION_LETTER", "Termination letter"),
  t("IDENTIFICATION", "NATIONAL_ID", "National identification", true),
  t("IDENTIFICATION", "INTERNATIONAL_PASSPORT", "International passport", true),
  t("IDENTIFICATION", "DRIVERS_LICENCE", "Driver's licence", true),
  t("IDENTIFICATION", "OTHER_ID", "Other approved identification", true),
  t("EDUCATION_PROFESSIONAL", "ACADEMIC_CERTIFICATE", "Academic certificate"),
  t("EDUCATION_PROFESSIONAL", "PROFESSIONAL_CERTIFICATE", "Professional certificate", true),
  t("EDUCATION_PROFESSIONAL", "TRAINING_CERTIFICATE", "Training certificate"),
  t("EDUCATION_PROFESSIONAL", "LICENCE", "Licence", true),
  t("COMPLIANCE", "GUARANTOR_FORM", "Guarantor form"),
  t("COMPLIANCE", "REFERENCE_CHECK", "Reference check"),
  t("COMPLIANCE", "BACKGROUND_VERIFICATION", "Background verification"),
  t("COMPLIANCE", "SIGNED_POLICY_DECLARATION", "Signed policy or declaration"),
  t("MEDICAL", "MEDICAL_EXAMINATION_REPORT", "Medical examination report"),
  t("MEDICAL", "MEDICAL_FITNESS_CERTIFICATE", "Medical fitness certificate", true),
  t("STATUTORY", "TAX_DOCUMENTATION", "Tax documentation"),
  t("STATUTORY", "PENSION_DOCUMENTATION", "Pension documentation"),
  t("STATUTORY", "OTHER_STATUTORY", "Other statutory record"),
  t("EXIT", "EXIT_RESIGNATION_OR_TERMINATION", "Resignation or termination documentation"),
  t("EXIT", "CLEARANCE_FORM", "Clearance form"),
  t("EXIT", "EXIT_INTERVIEW", "Exit interview documentation"),
  t("EXIT", "HANDOVER_FORM", "Handover documentation"),
  t("EXIT", "ASSET_RETURN", "Asset return documentation"),
];

// ───────────────────────────── The file ─────────────────────────────

export const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;

export type FileKind = "pdf" | "doc" | "docx" | "jpeg" | "png";

const MIME: Record<FileKind, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
};
export const mimeFor = (kind: FileKind) => MIME[kind];

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

/** What the file really is, from its first bytes. A zip is a Word document only if it holds [Content_Types].xml and a word/ folder. */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const text = Buffer.from(bytes).toString("latin1");
    return text.includes("[Content_Types].xml") && text.includes("word/") ? "docx" : null;
  }
  return null;
}

/** PDFs and images can be previewed in the browser; Word files are downloaded. */
export const inlineViewable = (kind: FileKind) => kind === "pdf" || kind === "jpeg" || kind === "png";

const limitText = (max: number) => (max >= 1024 * 1024 ? `${Math.round((max / (1024 * 1024)) * 10) / 10} MB`.replace(/\.0 MB$/, " MB") : `${max} bytes`);

export type UploadCheck = { ok: true; kind: FileKind; mime: string; safeName: string } | { ok: false; error: string };

/** The server's checks on one uploaded file: not empty, not too big, an allowed extension, and contents that really are that kind of file. */
export function checkUpload(name: string, bytes: Uint8Array, maxBytes: number = MAX_FILE_BYTES): UploadCheck {
  if (!bytes.length) return { ok: false, error: "The file is empty." };
  if (bytes.length > maxBytes) return { ok: false, error: `The file is larger than ${limitText(maxBytes)}.` };
  const safeName = safeFileName(name);
  const ext = (/\.([A-Za-z0-9]+)$/.exec(safeName)?.[1] ?? "").toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, error: "Only PDF, DOC, DOCX, JPG, JPEG, PNG files can be uploaded." };
  const kind = sniffFileKind(bytes);
  if (!kind) return { ok: false, error: "The file's contents are not a PDF, Word document or image, so it was refused." };
  const expected: FileKind = ext === "jpg" || ext === "jpeg" ? "jpeg" : (ext as FileKind);
  if (kind !== expected) return { ok: false, error: `The file does not match its ${ext.toUpperCase()} name: its contents are a ${kind.toUpperCase()} file, so it was refused.` };
  return { ok: true, kind, mime: mimeFor(kind), safeName };
}

/** A name that is safe to store and to send back: no path, one underscore for each unusual character, at most 120 characters, extension kept. */
export function safeFileName(raw: string): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._ ()-]/g, "_").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "document";
  if (cleaned.length <= 120) return cleaned;
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(cleaned)?.[0] ?? "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/** What to show: an approved document is Expired the day after its expiry date. */
export function effectiveStatus(status: DocumentStatus, expiryDate: Date | null | undefined, today: Date): DocumentStatus {
  if (status !== "APPROVED" || !expiryDate) return status;
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return expiryDate.getTime() < startOfToday ? "EXPIRED" : status;
}

// ───────────────────── Records from before document management ─────────────────────

/** How a reference-only record (the old fixed list of ten types) is shown and whether it counts as sensitive. */
export const LEGACY_TYPES: Record<string, { name: string; category: DocumentCategory; sensitive: boolean }> = {
  NATIONAL_ID: { name: "National ID", category: "IDENTIFICATION", sensitive: true },
  PASSPORT: { name: "Passport", category: "IDENTIFICATION", sensitive: true },
  DRIVERS_LICENSE: { name: "Driver's licence", category: "IDENTIFICATION", sensitive: true },
  GUARD_LICENSE: { name: "Guard licence", category: "EDUCATION_PROFESSIONAL", sensitive: false },
  FIREARMS_LICENSE: { name: "Firearms licence", category: "EDUCATION_PROFESSIONAL", sensitive: false },
  MEDICAL_CERTIFICATE: { name: "Medical certificate", category: "MEDICAL", sensitive: true },
  POLICE_CLEARANCE: { name: "Police clearance", category: "COMPLIANCE", sensitive: false },
  EMPLOYMENT_CONTRACT: { name: "Employment contract", category: "EMPLOYMENT", sensitive: false },
  ACADEMIC_CERTIFICATE: { name: "Academic certificate", category: "EDUCATION_PROFESSIONAL", sensitive: false },
  OTHER: { name: "Other", category: "COMPLIANCE", sensitive: false },
};
