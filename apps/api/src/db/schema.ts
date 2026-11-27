import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
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

/** Indice di ricerca full-text di PostgreSQL (italiano + inglese). */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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
    /** Staff del portale: selezione delle Maison, controversie. */
    isAdmin: boolean("is_admin").notNull().default(false),
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

// =============================================================================================
// Maison e catalogo
// =============================================================================================

/** Testo nelle due lingue: l'inglese è facoltativo e, se manca, si mostra l'italiano. */
export type I18nText = { it: string; en?: string };

export const discipline = pgEnum("discipline", ["FOOD", "BEVERAGE", "TAILORING", "SPORT", "CRAFTS"]);
export const maisonStatus = pgEnum("maison_status", ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"]);

export const maisons = pgTable(
  "maisons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    discipline: discipline("discipline").notNull(),
    tagline: jsonb("tagline").$type<I18nText>().notNull(),
    story: jsonb("story").$type<I18nText>().notNull(),
    craft: jsonb("craft").$type<I18nText>(),
    foundedYear: integer("founded_year"),
    region: text("region").notNull(),
    province: text("province").notNull(),
    city: text("city").notNull(),
    certifications: jsonb("certifications").$type<string[]>().notNull().default([]),
    /** Condizioni per i clienti professionali. */
    b2bMinOrderCents: integer("b2b_min_order_cents"),
    leadTimeDays: integer("lead_time_days"),
    coverImage: text("cover_image"),
    /** Commissione del portale in punti base (1000 = 10%). */
    commissionBps: integer("commission_bps").notNull().default(1000),
    /** Accetta commissioni su misura nell'Atelier. */
    acceptsCommissions: boolean("accepts_commissions").notNull().default(false),
    status: maisonStatus("status").notNull().default("DRAFT"),
    /** Calcolato dal servizio di ricerca su profilo, territorio e collezione. */
    searchVector: tsvector("search_vector"),
    reviewNote: text("review_note"),
    submittedAt: ts("submitted_at"),
    approvedAt: ts("approved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("maisons_slug_uq").on(t.slug),
    uniqueIndex("maisons_account_uq").on(t.accountId),
    index("maisons_territory_idx").on(t.status, t.region, t.province),
    index("maisons_search_idx").using("gin", t.searchVector),
  ],
);

export const productUnit = pgEnum("product_unit", ["PIECE", "KG", "BOTTLE", "CASE", "METRE", "SET"]);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    maisonId: uuid("maison_id")
      .notNull()
      .references(() => maisons.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: jsonb("name").$type<I18nText>().notNull(),
    description: jsonb("description").$type<I18nText>().notNull(),
    /** Prezzo al pubblico, IVA inclusa, in centesimi. */
    priceCents: integer("price_cents").notNull(),
    /** Prezzo riservato ai clienti con partita IVA (IVA esclusa); null = come al pubblico. */
    b2bPriceCents: integer("b2b_price_cents"),
    unit: productUnit("unit").notNull().default("PIECE"),
    minQty: integer("min_qty").notNull().default(1),
    /** null = disponibilità su richiesta / su commissione. */
    stock: integer("stock"),
    madeToOrder: boolean("made_to_order").notNull().default(false),
    /** Aliquota IVA in punti base: 400 (4%), 500, 1000, 2200. */
    vatRateBps: integer("vat_rate_bps").notNull().default(2200),
    image: text("image"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_slug_uq").on(t.maisonId, t.slug), index("products_maison_idx").on(t.maisonId, t.position)],
);

// =============================================================================================
// Ordini, pagamenti in custodia, movimenti
// =============================================================================================

export const orderStatus = pgEnum("order_status", [
  "AWAITING_AUTHORIZATION", // creato, il cliente deve autorizzare il pagamento (SCA)
  "PAID", // fondi incassati e in custodia, la Maison deve accettare
  "ACCEPTED", // la Maison prepara l'ordine
  "SHIPPED",
  "DELIVERED", // il cliente ha confermato: i fondi vengono rilasciati
  "COMPLETED", // accredito alla Maison eseguito
  "DISPUTED", // il cliente ha segnalato un problema: decide lo staff
  "CANCELLED", // annullato prima del pagamento o rifiutato dalla Maison (con rimborso)
  "REFUNDED", // rimborsato dopo una controversia
]);

export type ShippingAddress = {
  name: string;
  street: string;
  zip: string;
  city: string;
  province: string;
  country: string;
  phone: string;
  notes?: string;
};

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    buyerAccountId: uuid("buyer_account_id")
      .notNull()
      .references(() => accounts.id),
    maisonId: uuid("maison_id")
      .notNull()
      .references(() => maisons.id),
    status: orderStatus("status").notNull().default("AWAITING_AUTHORIZATION"),
    /** Ordine professionale: prezzi riservati, netti + IVA, fattura alla partita IVA. */
    professional: boolean("professional").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    payoutCents: integer("payout_cents").notNull(),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>().notNull(),
    note: text("note"),
    carrier: text("carrier"),
    trackingCode: text("tracking_code"),
    authChallengeId: uuid("auth_challenge_id"),
    paymentProvider: text("payment_provider"),
    paymentRef: text("payment_ref"),
    /** Tappa di pagamento di una commissione su misura (acconto o saldo); null per gli ordini dal catalogo. */
    commissionId: uuid("commission_id"),
    stage: text("stage"), // DEPOSIT | BALANCE
    paidAt: ts("paid_at"),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),
    completedAt: ts("completed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_number_uq").on(t.number),
    index("orders_buyer_idx").on(t.buyerAccountId, t.createdAt),
    index("orders_maison_idx").on(t.maisonId, t.createdAt),
    index("orders_status_idx").on(t.status, t.shippedAt),
  ],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  name: jsonb("name").$type<I18nText>().notNull(),
  unit: productUnit("unit").notNull(),
  qty: integer("qty").notNull(),
  /** Prezzo unitario netto (IVA esclusa) e aliquota al momento dell'ordine. */
  unitNetCents: integer("unit_net_cents").notNull(),
  vatRateBps: integer("vat_rate_bps").notNull(),
  lineNetCents: integer("line_net_cents").notNull(),
  lineVatCents: integer("line_vat_cents").notNull(),
});

/** Cronologia visibile a cliente e Maison. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatus("status").notNull(),
    actor: text("actor").notNull(), // BUYER | MAKER | STAFF | SYSTEM
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

/** Registro contabile dei movimenti di denaro: incasso, commissione, accredito, rimborso. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: text("kind").notNull(), // CHARGE | COMMISSION | PAYOUT | REFUND
    amountCents: integer("amount_cents").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_order_idx").on(t.orderId)],
);

export type Order = typeof orders.$inferSelect;

// =============================================================================================
// L'Atelier: commissioni su misura
// =============================================================================================

export const commissionStatus = pgEnum("commission_status", [
  "REQUESTED", // il cliente ha inviato il brief, la Maison deve rispondere entro 96 ore
  "IN_DIALOGUE",
  "PROPOSED", // c'è una proposta in attesa di risposta
  "AGREED", // proposta accettata: acconto da pagare o pagato
  "IN_WORK", // lavorazione iniziata: l'acconto è della Maison
  "BALANCE_DUE", // il maestro ha chiesto il saldo; poi spedizione e consegna seguono l'ordine del saldo
  "DECLINED",
  "EXPIRED",
  "WITHDRAWN",
]);

export const commissions = pgTable(
  "commissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    buyerAccountId: uuid("buyer_account_id")
      .notNull()
      .references(() => accounts.id),
    maisonId: uuid("maison_id")
      .notNull()
      .references(() => maisons.id),
    status: commissionStatus("status").notNull().default("REQUESTED"),
    /** Lingua in cui il cliente conduce la conversazione. */
    language: text("language").notNull(),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
    /** Traduzioni della descrizione del brief, per lingua. */
    briefTranslations: jsonb("brief_translations").$type<Record<string, string>>().notNull().default({}),
    measurements: jsonb("measurements").$type<Record<string, unknown>>(),
    measurementsConsentAt: ts("measurements_consent_at"),
    respondBy: ts("respond_by").notNull(),
    firstResponseAt: ts("first_response_at"),
    deliveryAddress: jsonb("delivery_address").$type<ShippingAddress>(),
    depositOrderId: uuid("deposit_order_id"),
    balanceOrderId: uuid("balance_order_id"),
    workStartedAt: ts("work_started_at"),
    buyerReadAt: ts("buyer_read_at"),
    makerReadAt: ts("maker_read_at"),
    buyerNotifiedAt: ts("buyer_notified_at"),
    makerNotifiedAt: ts("maker_notified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("commissions_number_uq").on(t.number),
    index("commissions_buyer_idx").on(t.buyerAccountId, t.updatedAt),
    index("commissions_maison_idx").on(t.maisonId, t.updatedAt),
    index("commissions_status_idx").on(t.status, t.respondBy),
  ],
);

export const commissionMessages = pgTable(
  "commission_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commissionId: uuid("commission_id")
      .notNull()
      .references(() => commissions.id, { onDelete: "cascade" }),
    author: text("author").notNull(), // BUYER | MAKER | SYSTEM
    authorAccountId: uuid("author_account_id"),
    kind: text("kind").notNull(), // TEXT | IMAGE | EVENT
    body: text("body"),
    /** Lingua in cui è stato scritto. */
    language: text("language"),
    translations: jsonb("translations").$type<Record<string, string>>().notNull().default({}),
    /** Chiave del file privato (foto), servito solo ai partecipanti. */
    attachment: text("attachment"),
    dictated: boolean("dictated").notNull().default(false),
    /** Il testo conteneva recapiti esterni e l'autore ha confermato l'invio. */
    contactFlag: boolean("contact_flag").notNull().default(false),
    event: text("event"),
    eventData: jsonb("event_data").$type<Record<string, string | number>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("commission_messages_idx").on(t.commissionId, t.createdAt)],
);

export const commissionProposals = pgTable(
  "commission_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commissionId: uuid("commission_id")
      .notNull()
      .references(() => commissions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("SENT"), // SENT | ACCEPTED | SUPERSEDED | CHANGES_REQUESTED | WITHDRAWN
    description: text("description").notNull(),
    language: text("language").notNull(),
    translations: jsonb("translations").$type<Record<string, string>>().notNull().default({}),
    priceCents: integer("price_cents").notNull(),
    depositPct: integer("deposit_pct").notNull(),
    depositCents: integer("deposit_cents").notNull(),
    leadTimeWeeks: integer("lead_time_weeks").notNull(),
    fittings: integer("fittings").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    respondedAt: ts("responded_at"),
  },
  (t) => [uniqueIndex("commission_proposals_version_uq").on(t.commissionId, t.version)],
);

export type Commission = typeof commissions.$inferSelect;
export type CommissionMessage = typeof commissionMessages.$inferSelect;
export type CommissionProposal = typeof commissionProposals.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;

export type Account = typeof accounts.$inferSelect;
export type Maison = typeof maisons.$inferSelect;
export type Product = typeof products.$inferSelect;
export type AuthChallenge = typeof authChallenges.$inferSelect;
export type Device = typeof devices.$inferSelect;
