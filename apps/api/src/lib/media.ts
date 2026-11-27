import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomToken } from "./crypto";
import { ApiError } from "./errors";

/** Archivio delle immagini. In locale su disco; in produzione si sostituisce con S3/GCS dietro la stessa interfaccia. */
export interface MediaStore {
  save(data: Buffer, ext: string): Promise<string>;
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Riconosce il formato dai primi byte, non dall'estensione dichiarata. */
export function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export class DiskMediaStore implements MediaStore {
  constructor(private dir: string) {}
  async save(data: Buffer, ext: string) {
    await mkdir(this.dir, { recursive: true });
    const name = `${randomToken(16)}.${ext}`;
    await writeFile(join(this.dir, name), data);
    return `/media/${name}`;
  }
}

export async function storeImage(store: MediaStore, data: Buffer): Promise<string> {
  if (data.length > MAX_IMAGE_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE");
  const ext = sniffImage(data);
  if (!ext) throw new ApiError(415, "IMAGE_TYPE_NOT_ALLOWED");
  return store.save(data, ext);
}

/**
 * File privati (foto scambiate nell'Atelier): fuori dalla cartella pubblica /media, letti solo
 * attraverso l'API dopo aver verificato che chi chiede partecipi alla conversazione.
 */
export class PrivateFiles {
  constructor(private dir: string) {}
  async saveImage(data: Buffer) {
    if (data.length > MAX_IMAGE_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE");
    const ext = sniffImage(data);
    if (!ext) throw new ApiError(415, "IMAGE_TYPE_NOT_ALLOWED");
    await mkdir(this.dir, { recursive: true });
    const key = `${randomToken(16)}.${ext}`;
    await writeFile(join(this.dir, key), data);
    return key;
  }
  async read(key: string) {
    const m = /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.exec(key);
    if (!m) return null;
    try {
      return { data: await readFile(join(this.dir, key)), type: m[1] === "jpg" ? "image/jpeg" : `image/${m[1]}` };
    } catch {
      return null;
    }
  }
}
