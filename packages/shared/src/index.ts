import { z } from "zod";
import { isValidCodiceFiscale, isValidMobilePhone, isValidPartitaIva, normalizePhone } from "./validators";

export * from "./validators";
export * from "./territory";
export * from "./catalog";
export * from "./search";
export * from "./orders";
export * from "./commissions";
export * from "./concierge";
import { PROVINCE_CODES } from "./territory";

/** Lato del mercato: DOMANDA (chi acquista) o OFFERTA (chi produce e vende). */
export const ACCOUNT_ROLES = ["BUYER", "MAKER"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Persona fisica o persona giuridica. */
export const SUBJECT_TYPES = ["PERSON", "COMPANY"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** Settori della domanda. */
export const BUYER_SECTORS = ["RESTAURANT", "HOSPITALITY", "RETAIL", "CORPORATE", "PRIVATE", "OTHER"] as const;
/** Settori dell'offerta. */
export const MAKER_SECTORS = ["FOOD", "BEVERAGE", "TAILORING", "SPORT", "CRAFTS"] as const;
export type Sector = (typeof BUYER_SECTORS)[number] | (typeof MAKER_SECTORS)[number];

export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Stati del ciclo di vita dell'account. */
export const ACCOUNT_STATUSES = [
  "PENDING_EMAIL", // registrato, in attesa del clic sul link di attivazione
  "PENDING_MFA", // email confermata, deve attivare la doppia autenticazione
  "ACTIVE",
  "LOCKED",
  "SUSPENDED",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Metodi del secondo fattore. */
export const MFA_METHODS = ["SMS", "TOTP", "MOBILE_APP"] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

/**
 * Regole della password: almeno 12 caratteri, con maiuscola, minuscola, cifra e simbolo.
 * Gli errori sono chiavi di traduzione, risolte dall'interfaccia nella lingua attiva.
 */
export const passwordSchema = z
  .string()
  .min(12, "password.too_short")
  .max(128, "password.too_long")
  .refine((v) => /[a-z]/.test(v), "password.lowercase")
  .refine((v) => /[A-Z]/.test(v), "password.uppercase")
  .refine((v) => /\d/.test(v), "password.digit")
  .refine((v) => /[^A-Za-z0-9]/.test(v), "password.symbol");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("email.invalid").max(254));

const phoneSchema = z
  .string()
  .refine(isValidMobilePhone, "phone.invalid")
  .transform(normalizePhone);

const consentsSchema = z.object({
  terms: z.literal(true, { error: "consent.terms_required" }),
  privacy: z.literal(true, { error: "consent.privacy_required" }),
  marketing: z.boolean().default(false),
});

const commonFields = {
  role: z.enum(ACCOUNT_ROLES),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  sector: z.string(),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => PROVINCE_CODES.includes(v), "province.invalid"),
  city: z.string().trim().min(2, "city.invalid").max(120),
  locale: z.enum(LOCALES).default("it"),
  consents: consentsSchema,
};

const personSchema = z.object({
  ...commonFields,
  subjectType: z.literal("PERSON"),
  firstName: z.string().trim().min(1, "name.required").max(80),
  lastName: z.string().trim().min(1, "name.required").max(80),
  fiscalCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidCodiceFiscale, "fiscal_code.invalid"),
});

const companySchema = z.object({
  ...commonFields,
  subjectType: z.literal("COMPANY"),
  companyName: z.string().trim().min(2, "company.required").max(200),
  vatNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/^IT/i, "").replace(/\s/g, ""))
    .refine(isValidPartitaIva, "vat.invalid"),
  /** Referente che apre l'account per conto dell'azienda. */
  firstName: z.string().trim().min(1, "name.required").max(80),
  lastName: z.string().trim().min(1, "name.required").max(80),
});

export const registrationSchema = z
  .discriminatedUnion("subjectType", [personSchema, companySchema])
  .superRefine((data, ctx) => {
    const allowed: readonly string[] = data.role === "MAKER" ? MAKER_SECTORS : BUYER_SECTORS;
    if (!allowed.includes(data.sector)) {
      ctx.addIssue({ code: "custom", path: ["sector"], message: "sector.invalid" });
    }
    if (data.role === "MAKER" && data.subjectType === "PERSON") {
      // Chi vende sul portale deve avere una partita IVA: l'offerta è riservata alle imprese.
      ctx.addIssue({ code: "custom", path: ["subjectType"], message: "maker.company_required" });
    }
  });

export type RegistrationInput = z.input<typeof registrationSchema>;
export type Registration = z.output<typeof registrationSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const otpSchema = z.string().regex(/^\d{6}$/, "otp.invalid");

/** Risposta del login con password: il secondo fattore è sempre richiesto. */
export interface LoginChallengeResponse {
  status: "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED";
  /** Identificativo opaco della transazione di login, valido pochi minuti. */
  loginToken: string;
  methods: MfaMethod[];
  /** Cellulare mascherato, es. +39 ••• ••• 4567 */
  maskedPhone?: string;
  expiresAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  role: AccountRole;
  subjectType: SubjectType;
  displayName: string;
  status: AccountStatus;
  locale: Locale;
  mfaMethods: MfaMethod[];
  isAdmin: boolean;
}

/**
 * Messaggi firmati con la chiave Ed25519 del dispositivo. Server e app li costruiscono
 * con le stesse funzioni, così il formato resta uno solo.
 */
export const deviceMessages = {
  enroll: (authorization: string, publicKey: string) => `MI1|enroll|${authorization}|${publicKey}`,
  login: (deviceId: string, nonce: string) => `MI1|login|${deviceId}|${nonce}`,
  pending: (deviceId: string, timestamp: number) => `MI1|pending|${deviceId}|${timestamp}`,
  respond: (challengeId: string, nonce: string, decision: "APPROVE" | "DENY") =>
    `MI1|respond|${challengeId}|${nonce}|${decision}`,
};

/** Contenuto del QR code mostrato sul sito per associare l'app. */
export const pairingUri = (code: string) => `maestranze://pair?code=${encodeURIComponent(code)}`;

/** Richiesta di approvazione mostrata sull'app. */
export interface PendingApproval {
  id: string;
  nonce: string;
  purpose: "LOGIN" | "TRANSACTION";
  channel: "WEB" | "MOBILE";
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
}
