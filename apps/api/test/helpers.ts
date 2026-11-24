import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { deviceMessages } from "@maestranze/shared";
import { buildApp, SESSION_COOKIE } from "../src/app";
import { security, type Config } from "../src/config";
import { createDb } from "../src/db/client";
import { MemoryNotifier } from "../src/lib/notifications";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://maestranze:maestranze@localhost:5432/maestranze_test";

export const WEB = "http://localhost:3000";

export async function setupApp() {
  const config: Config = {
    NODE_ENV: "test",
    PORT: 0,
    DATABASE_URL: TEST_DB,
    WEB_ORIGIN: WEB,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "test@maestranze.it",
    SMS_PROVIDER: "memory",
    PUSH_PROVIDER: "memory",
    security,
  };
  const { db, pool } = createDb(TEST_DB);
  await pool.query(
    "truncate accounts, email_tokens, devices, mfa_factors, auth_challenges, device_pairings, device_nonces, sessions, audit_events cascade",
  );
  const notifier = new MemoryNotifier();
  const clock = { offsetMs: 0 };
  const app = await buildApp({ db, config, notifier, now: () => new Date(Date.now() + clock.offsetMs) });
  return { app, notifier, clock, pool, close: async () => (await app.close(), await pool.end()) };
}

export type TestApp = Awaited<ReturnType<typeof setupApp>>;

let seq = 0;
export function buyerPayload(overrides: Record<string, unknown> = {}) {
  seq++;
  return {
    role: "BUYER",
    subjectType: "COMPANY",
    companyName: "Trattoria del Borgo S.r.l.",
    vatNumber: "12345678903",
    firstName: "Giulia",
    lastName: "Bianchi",
    email: `giulia${seq}@borgo.it`,
    password: "Ricotta&Miele2026",
    phone: "333 123 4567",
    sector: "RESTAURANT",
    province: "fi",
    city: "Firenze",
    locale: "it",
    consents: { terms: true, privacy: true },
    ...overrides,
  };
}

/** Registrazione + attivazione via email + primo accesso con SMS: restituisce un account attivo con cookie di sessione. */
export async function activeAccount(t: TestApp, overrides: Record<string, unknown> = {}) {
  const payload = buyerPayload(overrides);
  await t.app.inject({ method: "POST", url: "/v1/auth/register", payload });
  const email = t.notifier.lastEmailTo(payload.email)!;
  const token = new URL(email.actionUrl!).searchParams.get("token");
  await t.app.inject({ method: "POST", url: "/v1/auth/activate", payload: { token } });
  const login = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: payload.email, password: payload.password } });
  const { loginToken } = login.json();
  await t.app.inject({ method: "POST", url: "/v1/auth/mfa/sms", payload: { loginToken } });
  const code = t.notifier.smss.at(-1)!.code;
  const verify = await t.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { loginToken, method: "SMS", code } });
  const cookie = verify.cookies.find((c) => c.name === SESSION_COOKIE)!.value;
  return { payload, cookie, user: verify.json().user };
}

/** Un telefono finto: coppia di chiavi Ed25519 come quella custodita nel portachiavi del dispositivo. */
export function fakePhone() {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = Buffer.from(ed25519.getPublicKey(secretKey)).toString("base64");
  const sign = (msg: string) => Buffer.from(ed25519.sign(new TextEncoder().encode(msg), secretKey)).toString("base64");
  return { publicKey, sign, deviceId: "" };
}

export async function pairPhone(t: TestApp, cookie: string) {
  const phone = fakePhone();
  const pairing = await t.app.inject({ method: "POST", url: "/v1/me/devices/pairing", cookies: { [SESSION_COOKIE]: cookie } });
  const { code } = pairing.json();
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/device/enroll",
    headers: { "x-client": "mobile" },
    payload: {
      pairingCode: code,
      publicKey: phone.publicKey,
      signature: phone.sign(deviceMessages.enroll(code, phone.publicKey)),
      name: "iPhone di Giulia",
      platform: "ios",
      pushToken: "ExponentPushToken[test]",
    },
  });
  phone.deviceId = res.json().deviceId;
  return phone;
}
