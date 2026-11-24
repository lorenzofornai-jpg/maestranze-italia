import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { ed25519 } from "@noble/curves/ed25519.js";

/** Token casuale ad alta entropia, adatto a URL. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Codice numerico di 6 cifre generato con un RNG crittografico. */
export function randomOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Argon2id con i parametri raccomandati da OWASP.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Hash fittizio per uniformare i tempi di risposta quando l'email non esiste. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("maestranze-dummy-password");
  await verifyPassword(await dummyHash, password);
}

// --- Cifratura dei dati sensibili a riposo (AES-256-GCM) ---------------------------------------

export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string, keyB64: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato cifrato non valido");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// --- TOTP (RFC 6238), compatibile con Google Authenticator, Microsoft Authenticator, 1Password -----

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Carattere base32 non valido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export const TOTP_STEP_SECONDS = 30;

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Verifica un codice TOTP con tolleranza di ±1 passo (30 s).
 * Restituisce il passo accettato, così il chiamante può rifiutare il riuso dello stesso codice.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now(), lastStep?: number | null): number | null {
  const current = totpStep(now);
  for (const delta of [0, -1, 1]) {
    const step = current + delta;
    if (lastStep != null && step <= lastStep) continue;
    if (safeEqual(hotp(secretB32, step), code)) return step;
  }
  return null;
}

export function totpUri(secretB32: string, accountLabel: string, issuer = "Maestranze Italia"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Firma del dispositivo (Ed25519) ----------------------------------------------------------

export function isValidPublicKey(b64: string): boolean {
  try {
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) return false;
    ed25519.Point.fromBytes(new Uint8Array(key));
    return true;
  } catch {
    return false;
  }
}

export function verifyDeviceSignature(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    return ed25519.verify(
      new Uint8Array(Buffer.from(signatureB64, "base64")),
      new TextEncoder().encode(message),
      new Uint8Array(Buffer.from(publicKeyB64, "base64")),
    );
  } catch {
    return false;
  }
}
