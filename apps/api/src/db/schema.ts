import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const accountRole = pgEnum("account_role", ["BUYER", "MAKER"]);
export const subjectType = pgEnum("subject_type", ["PERSON", "COMPANY"]);
export const accountStatus = pgEnum("account_status", [
  "PENDING_EMAIL",
  "PENDING_MFA",
  "ACTIVE",
  "LOCKED",
  "SUSPENDED",
]);
export const mfaMethod = pgEnum("mfa_method", ["SMS", "TOTP", "MOBILE_APP"]);
export const emailTokenPurpose = pgEnum("email_token_purpose", ["ACTIVATION", "PASSWORD_RESET"]);
export const channel = pgEnum("channel", ["WEB", "MOBILE"]);
export const challengeStage = pgEnum("challenge_stage", [
  "PASSWORD_OK", // password corretta, manca il secondo fattore
  "COMPLETED",
  "DENIED",
]);
export const pushStatus = pgEnum("push_status", ["NONE", "PENDING", "APPROVED", "DENIED"]);

/** Account di domanda (BUYER) e di offerta (MAKER). */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: accountRole("role").notNull(),
    subjectType: subjectType("subject_type").notNull(),
    status: accountStatus("status").notNull().default("PENDING_EMAIL"),
    email: text("email").notNull(),
    emailVerifiedAt: ts("email_verified_at"),
    passwordHash: text("password_hash").notNull(),
    phone: text("phone").notNull(),
    phoneVerifiedAt: ts("phone_verified_at"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    companyName: text("company_name"),
    vatNumber: text("vat_number"),
    fiscalCode: text("fiscal_code"),
    sector: text("sector").notNull(),
    province: text("province").notNull(),
    city: text("city").notNull(),
    locale: text("locale").notNull().default("it"),
    consents: jsonb("consents").$type<{ terms: boolean; privacy: boolean; marketing: boolean; at: string }>().notNull(),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_email_uq").on(t.email)],
);

/** Link monouso inviati via email (attivazione, recupero password). Si salva solo l'hash. */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    purpose: emailTokenPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_tokens_hash_uq").on(t.tokenHash)],
);

/** Dispositivi mobili associati: la chiave privata Ed25519 resta sul telefono, protetta da biometria/PIN. */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    publicKey: text("public_key").notNull(),
    pushToken: text("push_token"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_account_idx").on(t.accountId)],
);

/** Fattori di autenticazione attivi per account. */
export const mfaFactors = pgTable(
  "mfa_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    method: mfaMethod("method").notNull(),
    /** Segreto TOTP cifrato con AES-256-GCM. */
    totpSecretEnc: text("totp_secret_enc"),
    /** Ultimo passo TOTP accettato, per impedire il riuso dello stesso codice. */
    totpLastStep: integer("totp_last_step"),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    confirmedAt: ts("confirmed_at"),
    lastUsedAt: ts("last_used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("mfa_factors_account_idx").on(t.accountId)],
);

/**
 * Transazione di autenticazione: nasce dopo la password corretta e si chiude con il secondo fattore
 * (OTP via SMS, codice TOTP o approvazione dall'app). Lo stesso meccanismo servirà a confermare i pagamenti.
 */
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    purpose: text("purpose").notNull().default("LOGIN"),
    /** Dettagli mostrati sull'app al momento dell'approvazione (es. importo e beneficiario di un pagamento). */
    details: jsonb("details").$type<Record<string, unknown>>(),
    channel: channel("channel").notNull(),
    enrollment: boolean("enrollment").notNull().default(false),
    stage: challengeStage("stage").notNull().default("PASSWORD_OK"),
    otpHash: text("otp_hash"),
    otpExpiresAt: ts("otp_expires_at"),
    otpSentCount: integer("otp_sent_count").notNull().default(0),
    otpLastSentAt: ts("otp_last_sent_at"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    pushStatus: pushStatus("push_status").notNull().default("NONE"),
    pushNonce: text("push_nonce"),
    pushDeviceId: uuid("push_device_id").references(() => devices.id, { onDelete: "set null" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    expiresAt: ts("expires_at").notNull(),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("auth_challenges_token_uq").on(t.tokenHash), index("auth_challenges_account_idx").on(t.accountId)],
);

/** Codici di abbinamento dell'app mostrati come QR code sul sito, validi pochi minuti. */
export const devicePairings = pgTable(
  "device_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("device_pairings_code_uq").on(t.codeHash)],
);

/** Nonce monouso per l'accesso diretto dall'app con la chiave del dispositivo. */
export const deviceNonces = pgTable("device_nonces", {
  nonce: text("nonce").primaryKey(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

/** Sessioni revocabili: nel cookie (web) o nell'header Authorization (app) viaggia un token opaco, qui solo l'hash. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    channel: channel("channel").notNull(),
    mfaMethod: mfaMethod("mfa_method").notNull(),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_account_idx").on(t.accountId)],
);

/** Registro di sicurezza: accessi, cambi di fattore, dispositivi. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().default(sql`now()`),
  },
  (t) => [index("audit_events_account_idx").on(t.accountId, t.createdAt)],
);

export type Account = typeof accounts.$inferSelect;
export type AuthChallenge = typeof authChallenges.$inferSelect;
export type Device = typeof devices.$inferSelect;
