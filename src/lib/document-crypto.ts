import crypto from "node:crypto";

/**
 * Encrypting stored documents and signing short-lived download links. Server only.
 *
 * Files are encrypted with AES-256-GCM before they are saved; the key is a 32-byte secret in the environment (DOCUMENT_ENCRYPTION_KEY, base64),
 * never in the repository, and it must be backed up separately from the database: without it the files cannot be read. Each file gets a fresh random
 * nonce, and is bound to its own version (the "additional data"), so a stored file cannot be swapped for another version's without being refused.
 * A download link is a signed, expiring claim tied to one user, one company and one file version.
 */

export class DocumentKeyError extends Error {
  constructor() {
    super("Document storage is not configured: set DOCUMENT_ENCRYPTION_KEY to a base64 32-byte secret.");
    this.name = "DocumentKeyError";
  }
}

/** The configured key. The message never contains the key. */
export function documentKey(): Buffer {
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw) throw new DocumentKeyError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new DocumentKeyError();
  return key;
}

export interface Encrypted {
  data: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptBytes(plain: Buffer, key: Buffer, aad: string): Encrypted {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data, iv, tag: cipher.getAuthTag() };
}

/** Throws if the key is wrong, the bytes were changed, or the file belongs to a different version. */
export function decryptBytes(e: Encrypted, key: Buffer, aad: string): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, e.iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(e.tag);
  return Buffer.concat([decipher.update(e.data), decipher.final()]);
}

/** The key used to sign links, derived from the document key so there is no second secret to look after. */
export function linkSecret(key: Buffer): Buffer {
  return crypto.createHmac("sha256", key).update("document-link-v1").digest();
}

export interface LinkClaims {
  /** the document version */
  v: string;
  /** the user it was issued to */
  u: string;
  /** the company */
  o: string;
  m: "view" | "download";
  /** expiry, seconds since 1970 */
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signLink(claims: LinkClaims, secret: Buffer): string {
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(crypto.createHmac("sha256", secret).update(body).digest())}`;
}

/** The claims if the signature is genuine and the link has not expired, else null. */
export function verifyLink(token: string, secret: Buffer, nowSeconds: number): LinkClaims | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  let given: Buffer;
  try {
    given = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LinkClaims;
    if (typeof c.v !== "string" || typeof c.u !== "string" || typeof c.o !== "string" || (c.m !== "view" && c.m !== "download") || typeof c.exp !== "number") return null;
    return c.exp >= nowSeconds ? c : null;
  } catch {
    return null;
  }
}
