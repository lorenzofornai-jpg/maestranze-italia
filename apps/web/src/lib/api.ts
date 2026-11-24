/** Client dell'API: passa dal proxy /api dello stesso dominio, così il cookie di sessione resta di prima parte. */
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields: Record<string, string> = {},
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: init.body ? { "content-type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiFailure(0, "generic");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { code = "generic", fields = {}, ...extra } = (data as { error?: Record<string, unknown> }).error ?? {};
    throw new ApiFailure(res.status, String(code), fields as Record<string, string>, extra);
  }
  return data as T;
}

/** Messaggio d'errore leggibile nella lingua attiva. */
export function errorMessage(t: (k: string, v?: Record<string, string | number>) => string, err: unknown): string {
  if (err instanceof ApiFailure) {
    if (err.code === "INVALID_CODE") return t("error.INVALID_CODE", { n: Number(err.extra.attemptsLeft ?? 0) });
    const key = `error.${err.code}`;
    const msg = t(key);
    return msg === key ? t("error.generic") : msg;
  }
  return t("error.generic");
}

/** Caricamento di un file (immagini) con multipart/form-data. */
export async function uploadFile<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/v1${path}`, { method: "POST", body: form, credentials: "same-origin" }).catch(() => null);
  if (!res) throw new ApiFailure(0, "generic");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { code = "generic", fields = {}, ...extra } = (data as { error?: Record<string, unknown> }).error ?? {};
    throw new ApiFailure(res.status, String(code), fields as Record<string, string>, extra);
  }
  return data as T;
}

/** Euro scritti dall'utente («12,50») → centesimi; vuoto → null. */
export const toCents = (v: string): number | null => {
  // «1.250,50» (italiano) oppure «1250.50»: con la virgola i punti sono migliaia.
  const raw = v.replace(/\s|€/g, "");
  const clean = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const fromCents = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
