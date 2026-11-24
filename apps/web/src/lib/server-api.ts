import "server-only";
import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Chiamata all'API dal server di Next, inoltrando il cookie di sessione (per i prezzi riservati). */
export async function serverApi<T>(path: string): Promise<T | null> {
  const jar = await cookies();
  const session = jar.get("mi_session");
  const res = await fetch(`${API_URL}/v1${path}`, {
    headers: session ? { cookie: `mi_session=${session.value}` } : {},
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as T;
}

/** Le immagini passano dal proxy /api dello stesso dominio. */
export const mediaUrl = (path: string | null | undefined) => (path ? `/api${path}` : null);
