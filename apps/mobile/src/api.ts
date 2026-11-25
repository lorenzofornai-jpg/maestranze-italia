import Constants from "expo-constants";

// Indirizzo dell'API: EXPO_PUBLIC_API_URL (impostato dallo script del Codespace) oppure extra.apiUrl in app.json.
const BASE =
  (process.env.EXPO_PUBLIC_API_URL || (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl || "http://localhost:4000").replace(/\/$/, "") +
  "/v1";

export class ApiFailure extends Error {
  constructor(public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

let sessionToken: string | null = null;
export const setSession = (token: string | null) => {
  sessionToken = token;
};

export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        "x-client": "mobile",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiFailure("generic");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { code = "generic", ...extra } = data.error ?? {};
    throw new ApiFailure(code, extra);
  }
  return data as T;
}
