import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { deviceMessages } from "@maestranze/shared";
import { buildApp, SESSION_COOKIE } from "../src/app";
import { security, type Config } from "../src/config";
import { createDb } from "../src/db/client";
import { MemoryNotifier } from "../src/lib/notifications";
import { SandboxPaymentProvider } from "../src/orders/payments";
import { FakeTranslator } from "../src/lib/translate";

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
    MEDIA_DIR: join(tmpdir(), "maestranze-test-media"),
    AI_SEARCH: "off",
    AI_TRANSLATION: "off",
    STUN_URLS: "stun:stun.example.org:3478",
    PUSH_PROVIDER: "memory",
    security,
  };
  const { db, pool } = createDb(TEST_DB);
  await pool.query(
    "truncate accounts, email_tokens, devices, mfa_factors, auth_challenges, device_pairings, device_nonces, sessions, audit_events, maisons, products, orders, order_items, order_events, ledger_entries, commissions, commission_messages, commission_proposals, commission_calls, call_signals, commission_appointments cascade",
  );
  const notifier = new MemoryNotifier();
  const clock = { offsetMs: 0 };
  const payments = new SandboxPaymentProvider();
  const translator = new FakeTranslator();
  const app = await buildApp({ db, config, notifier, payments, translator, now: () => new Date(Date.now() + clock.offsetMs) });
  return { app, notifier, clock, pool, payments, translator, close: async () => (await app.close(), await pool.end()) };
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

/** Promuove un account a staff del portale. */
export async function makeAdmin(t: TestApp, email: string) {
  await t.pool.query("update accounts set is_admin = true where email = $1", [email]);
}

/** PNG di 1×1 pixel, valido. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Corpo multipart con un solo file, per i test di caricamento. */
export function multipartBody(data: Buffer, filename = "foto.png", type = "image/png") {
  const boundary = "----maestranze" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export const MAISON = {
  name: "Sartoria Partenopea",
  discipline: "TAILORING",
  tagline: { it: "Giacche cucite a mano dal 1948", en: "Hand-sewn jackets since 1948" },
  story: {
    it: "Tre generazioni di sarti nel cuore di Chiaia. Ogni giacca richiede quaranta ore di lavoro e oltre cinquemila punti a mano, dalla spalla a camicia al taschino a barchetta.",
    en: "Three generations of tailors in the heart of Chiaia. Every jacket takes forty hours of work and over five thousand hand stitches.",
  },
  foundedYear: 1948,
  province: "NA",
  city: "Napoli",
  certifications: ["BOTTEGA_STORICA"],
  b2bMinOrderCents: 50000,
  leadTimeDays: 30,
};

export const PRODUCT = {
  name: { it: "Giacca in lino blu notte", en: "Midnight blue linen jacket" },
  description: { it: "Lino irlandese, spalla a camicia, tre bottoni stirati a due. Su misura.", en: "Irish linen, shirt shoulder." },
  priceCents: 280000,
  b2bPriceCents: 210000,
  unit: "PIECE",
  madeToOrder: true,
};

/** Crea e fa approvare una Maison completa (con un prodotto e la copertina). */
export async function approveMaison(t: TestApp, overrides: Record<string, unknown> = {}) {
  const { SESSION_COOKIE } = await import("../src/app");
  const as = (c: string) => ({ cookies: { [SESSION_COOKIE]: c } });
  const m = await activeAccount(t, { role: "MAKER", sector: String(overrides.discipline ?? "TAILORING") });
  await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: { ...MAISON, ...overrides }, ...as(m.cookie) });
  const { id: productId } = (await t.app.inject({ method: "POST", url: "/v1/me/products", payload: PRODUCT, ...as(m.cookie) })).json();
  const up = multipartBody(TINY_PNG);
  await t.app.inject({ method: "POST", url: "/v1/me/maison/cover", payload: up.payload, headers: up.headers, ...as(m.cookie) });
  await t.app.inject({ method: "POST", url: "/v1/me/maison/submit", payload: {}, ...as(m.cookie) });
  const { rows } = await t.pool.query("select id from maisons where account_id = (select id from accounts where email = $1)", [m.payload.email]);
  await t.pool.query("update maisons set status = 'APPROVED', approved_at = now() where id = $1", [rows[0].id]);
  return { maker: m, maisonId: rows[0].id as string, productId: productId as string };
}
