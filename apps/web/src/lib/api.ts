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
