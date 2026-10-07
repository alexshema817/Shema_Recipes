// AES-256-GCM encryption for values stored in Blobs (Kroger tokens), so a copy
// of the store alone is useless. The key is derived from SESSION_SECRET with
// HKDF; rotating SESSION_SECRET therefore also forces a Kroger reconnect.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET env var is missing or shorter than 16 characters");
  return Buffer.from(hkdfSync("sha256", s, "recipe-app", "blob-encryption-v1", 32));
}

export function isSealed(value) {
  return !!value && typeof value === "object" && value.enc === VERSION && typeof value.data === "string";
}

/** Encrypts any JSON-serializable value into { enc, iv, tag, data }. */
export function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { enc: VERSION, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
}

/** Decrypts a sealed value. Returns null when it was tampered with or the key changed. */
export function open(box) {
  if (!isSealed(box)) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(box.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(box.data, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}
