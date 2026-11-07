import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  ALLOWED_EXTENSIONS,
  checkUpload,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  effectiveStatus,
  inlineViewable,
  MAX_FILE_BYTES,
  safeFileName,
  sniffFileKind,
  STANDARD_TYPES,
} from "@/lib/documents";
import { decryptBytes, DocumentKeyError, documentKey, encryptBytes, linkSecret, signLink, verifyLink } from "@/lib/document-crypto";

// Electronic employee documents (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md).
// The files here are tiny synthetic byte strings with the right first bytes: no real documents.

const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("synthetic body")]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic")]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic")]);
const doc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("synthetic")]);
const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....[Content_Types].xml....word/document.xml....")]);
const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....[Content_Types].xml....xl/workbook.xml....")]);

describe("the standard document types", () => {
  it("cover every type the founder listed, in seven categories", () => {
    expect(DOCUMENT_CATEGORIES).toHaveLength(7);
    const names = STANDARD_TYPES.map((t) => t.name.toLowerCase());
    for (const wanted of [
      "offer letter", "appointment letter", "employment contract", "confirmation letter", "promotion letter", "transfer letter", "resignation letter", "termination letter",
      "national identification", "international passport", "driver's licence", "other approved identification",
      "academic certificate", "professional certificate", "training certificate", "licence",
      "guarantor form", "reference check", "background verification", "signed policy or declaration",
      "medical examination report", "medical fitness certificate",
      "tax documentation", "pension documentation", "other statutory record",
      "resignation or termination documentation", "clearance form", "exit interview documentation", "handover documentation", "asset return documentation",
    ])
      expect(names, wanted).toContain(wanted);
    for (const c of DOCUMENT_CATEGORIES) expect(STANDARD_TYPES.some((t) => t.category === c), c).toBe(true);
    for (const c of DOCUMENT_CATEGORIES) expect(CATEGORY_LABELS[c]).toBeTruthy();
  });
  it("have unique codes, and identification and medical are sensitive", () => {
    expect(new Set(STANDARD_TYPES.map((t) => t.code)).size).toBe(STANDARD_TYPES.length);
    for (const t of STANDARD_TYPES) expect(t.sensitive, t.name).toBe(t.category === "IDENTIFICATION" || t.category === "MEDICAL");
  });
});

describe("what kind of file it really is, from its first bytes", () => {
  it("recognises each supported format", () => {
    expect(sniffFileKind(pdf)).toBe("pdf");
    expect(sniffFileKind(png)).toBe("png");
    expect(sniffFileKind(jpeg)).toBe("jpeg");
    expect(sniffFileKind(doc)).toBe("doc");
    expect(sniffFileKind(docx)).toBe("docx");
  });
  it("refuses everything else, including other Office files and programs", () => {
    expect(sniffFileKind(xlsx)).toBeNull();
    expect(sniffFileKind(Buffer.from("MZ\x90\x00 a program"))).toBeNull();
    expect(sniffFileKind(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffFileKind(Buffer.alloc(0))).toBeNull();
  });
});

describe("checking an upload on the server", () => {
  it("accepts each supported format when the name and the contents agree", () => {
    expect(ALLOWED_EXTENSIONS).toEqual(["pdf", "doc", "docx", "jpg", "jpeg", "png"]);
    for (const [name, bytes, kind] of [["a.pdf", pdf, "pdf"], ["a.PNG", png, "png"], ["a.jpg", jpeg, "jpeg"], ["a.jpeg", jpeg, "jpeg"], ["a.doc", doc, "doc"], ["a.docx", docx, "docx"]] as const) {
      const r = checkUpload(name, bytes);
      expect(r.ok, name).toBe(true);
      if (r.ok) expect(r.kind).toBe(kind);
    }
  });
  it("refuses an empty file, an oversize file, a type that is not allowed, and contents that do not match the name", () => {
    expect(checkUpload("a.pdf", Buffer.alloc(0))).toMatchObject({ ok: false });
    const big = Buffer.concat([pdf, Buffer.alloc(MAX_FILE_BYTES)]);
    expect(checkUpload("big.pdf", big)).toMatchObject({ ok: false, error: expect.stringMatching(/larger than 10 MB/) });
    expect(checkUpload("a.exe", pdf)).toMatchObject({ ok: false, error: expect.stringMatching(/PDF, DOC, DOCX, JPG, JPEG, PNG/) });
    expect(checkUpload("noext", pdf)).toMatchObject({ ok: false });
    expect(checkUpload("renamed.pdf", Buffer.from("MZ\x90\x00 a program"))).toMatchObject({ ok: false });
    expect(checkUpload("photo.png", pdf)).toMatchObject({ ok: false, error: expect.stringMatching(/does not match/) });
    expect(checkUpload("letter.docx", doc)).toMatchObject({ ok: false });
  });
  it("respects a smaller limit when one is given", () => {
    expect(checkUpload("a.pdf", pdf, 10)).toMatchObject({ ok: false });
  });
});

describe("a file name that is safe to store and to send back", () => {
  it("drops any path, control characters and unusual characters, keeps the extension, and is not too long", () => {
    expect(safeFileName("..\\..\\windows\\evil.pdf")).toBe("evil.pdf");
    expect(safeFileName("/etc/passwd.png")).toBe("passwd.png");
    expect(safeFileName('Offer "final" <v2>\r\n.pdf')).toBe("Offer _final_ _v2___.pdf"); // one underscore for each unusual character
    const long = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(safeFileName("")).toBe("document");
  });
});

describe("an approved document past its expiry date shows as expired", () => {
  const today = new Date("2026-11-07T00:00:00Z");
  it("only an approved one, and only after the day", () => {
    expect(effectiveStatus("APPROVED", new Date("2026-11-06T00:00:00Z"), today)).toBe("EXPIRED");
    expect(effectiveStatus("APPROVED", new Date("2026-11-07T00:00:00Z"), today)).toBe("APPROVED"); // valid through its expiry date
    expect(effectiveStatus("APPROVED", null, today)).toBe("APPROVED");
    expect(effectiveStatus("PENDING", new Date("2020-01-01T00:00:00Z"), today)).toBe("PENDING");
    expect(effectiveStatus("ARCHIVED", new Date("2020-01-01T00:00:00Z"), today)).toBe("ARCHIVED");
  });
  it("only PDFs and images can be previewed in the browser", () => {
    expect(["pdf", "png", "jpeg"].every((k) => inlineViewable(k as never))).toBe(true);
    expect(inlineViewable("doc")).toBe(false);
    expect(inlineViewable("docx")).toBe(false);
  });
});

describe("encrypting a file", () => {
  const key = crypto.randomBytes(32);
  it("the stored bytes are not the file, and decrypt back to exactly the file", () => {
    const e = encryptBytes(pdf, key, "version-1");
    expect(e.data.equals(pdf)).toBe(false);
    expect(e.data.includes(Buffer.from("synthetic body"))).toBe(false);
    expect(decryptBytes(e, key, "version-1").equals(pdf)).toBe(true);
  });
  it("uses a new random nonce each time", () => {
    expect(encryptBytes(pdf, key, "v").iv.equals(encryptBytes(pdf, key, "v").iv)).toBe(false);
  });
  it("refuses a wrong key, a tampered file, or the file moved to another version", () => {
    const e = encryptBytes(pdf, key, "version-1");
    expect(() => decryptBytes(e, crypto.randomBytes(32), "version-1")).toThrow();
    expect(() => decryptBytes({ ...e, data: Buffer.concat([e.data.subarray(0, 3), Buffer.from([e.data[3] ^ 1]), e.data.subarray(4)]) }, key, "version-1")).toThrow();
    expect(() => decryptBytes(e, key, "version-2")).toThrow();
  });
  it("needs a configured 32-byte key and never echoes it", () => {
    const was = process.env.DOCUMENT_ENCRYPTION_KEY;
    try {
      delete process.env.DOCUMENT_ENCRYPTION_KEY;
      expect(() => documentKey()).toThrow(DocumentKeyError);
      process.env.DOCUMENT_ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
      expect(() => documentKey()).toThrow(DocumentKeyError);
      try {
        documentKey();
      } catch (e) {
        expect(String((e as Error).message)).not.toContain(process.env.DOCUMENT_ENCRYPTION_KEY);
      }
      process.env.DOCUMENT_ENCRYPTION_KEY = key.toString("base64");
      expect(documentKey().equals(key)).toBe(true);
    } finally {
      if (was === undefined) delete process.env.DOCUMENT_ENCRYPTION_KEY;
      else process.env.DOCUMENT_ENCRYPTION_KEY = was;
    }
  });
});

describe("a time-limited download link", () => {
  const secret = linkSecret(crypto.randomBytes(32));
  const now = 1_800_000_000;
  const claims = { v: "ver1", u: "user1", o: "org1", m: "download" as const, exp: now + 300 };
  it("verifies for the same claims until it expires", () => {
    const t = signLink(claims, secret);
    expect(verifyLink(t, secret, now)).toEqual(claims);
    expect(verifyLink(t, secret, now + 299)).toEqual(claims);
    expect(verifyLink(t, secret, now + 301)).toBeNull();
  });
  it("refuses a changed claim, another secret, and rubbish", () => {
    const t = signLink(claims, secret);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, u: "user2" })).toString("base64url");
    expect(verifyLink(`${forged}.${sig}`, secret, now)).toBeNull();
    expect(verifyLink(t, linkSecret(crypto.randomBytes(32)), now)).toBeNull();
    for (const bad of ["", "abc", "a.b.c", `${body}.`, `.${sig}`]) expect(verifyLink(bad, secret, now), bad).toBeNull();
  });
});
