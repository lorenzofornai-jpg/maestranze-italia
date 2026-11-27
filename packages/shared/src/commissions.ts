import { z } from "zod";
import type { OrderStatus } from "./orders";
import { PROVINCE_CODES } from "./territory";
import { isValidMobilePhone, normalizePhone } from "./validators";

// =============================================================================================
// L'Atelier: commissioni su misura, dal primo contatto al saldo
// =============================================================================================

/** Ore entro cui la Maison deve rispondere a una nuova richiesta. */
export const COMMISSION_RESPONSE_HOURS = 96;

/** Lingue in cui il cliente può condurre la conversazione: la traduzione è automatica. */
export const CONVERSATION_LANGUAGES = [
  ["it", "Italiano"],
  ["en", "English"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["sv", "Svenska"],
  ["pl", "Polski"],
  ["el", "Ελληνικά"],
  ["ru", "Русский"],
  ["tr", "Türkçe"],
  ["ar", "العربية"],
  ["he", "עברית"],
  ["hi", "हिन्दी"],
  ["zh", "中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
] as const;
export type ConversationLanguage = (typeof CONVERSATION_LANGUAGES)[number][0];
export const LANGUAGE_CODES = CONVERSATION_LANGUAGES.map(([c]) => c) as [ConversationLanguage, ...ConversationLanguage[]];
export const languageName = (code: string) => CONVERSATION_LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
/** Lingue che si scrivono da destra a sinistra. */
export const RTL_LANGUAGES = ["ar", "he"];

/** Paesi di consegna (ISO 3166-1 alpha-2): il nome si mostra con Intl.DisplayNames nella lingua attiva. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

// --- Il brief della sartoria ---------------------------------------------------------------------

export const GARMENTS = ["JACKET", "SUIT_2", "SUIT_3", "TUXEDO", "OVERCOAT", "TROUSERS", "WAISTCOAT", "SHIRT", "OTHER"] as const;
export const OCCASIONS = ["EVERYDAY", "BUSINESS", "CEREMONY", "WEDDING", "LEISURE"] as const;
export const FABRICS = ["WOOL", "CASHMERE", "LINEN", "COTTON", "SILK", "ADVICE"] as const;
export const BUDGETS = ["UP_TO_1500", "1500_3000", "3000_6000", "OVER_6000", "OPEN"] as const;
export const FITS = ["SLIM", "REGULAR", "RELAXED"] as const;

/**
 * Misure del corpo, tutte facoltative: il maestro le verifica comunque in videochiamata o in prova.
 * Ordine e intervalli plausibili, in centimetri e chilogrammi.
 */
export const MEASUREMENTS = [
  ["heightCm", 120, 230],
  ["weightKg", 35, 250],
  ["chestCm", 60, 180],
  ["waistCm", 50, 180],
  ["hipsCm", 60, 190],
  ["neckCm", 28, 60],
  ["shoulderCm", 30, 65],
  ["sleeveCm", 45, 80],
  ["backLengthCm", 55, 100],
  ["inseamCm", 55, 110],
] as const;
export type MeasurementKey = (typeof MEASUREMENTS)[number][0];

const measurementsShape = Object.fromEntries(
  MEASUREMENTS.map(([k, min, max]) => [k, z.coerce.number().min(min, "measure.range").max(max, "measure.range").optional().nullable()]),
) as unknown as Record<MeasurementKey, z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber>>>;

export const measurementsSchema = z.object({ ...measurementsShape, fit: z.enum(FITS).optional().nullable() });
export type Measurements = z.infer<typeof measurementsSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date.invalid");

export const tailoringBriefSchema = z.object({
  garment: z.enum(GARMENTS, { error: "brief.garment_required" }),
  occasion: z.enum(OCCASIONS, { error: "brief.occasion_required" }),
  fabric: z.enum(FABRICS, { error: "brief.fabric_required" }),
  colour: z.string().trim().max(200).optional(),
  description: z.string().trim().min(20, "brief.description_short").max(3000),
  budget: z.enum(BUDGETS).default("OPEN"),
  neededBy: isoDate.optional().nullable(),
  country: z.enum(COUNTRY_CODES as [string, ...string[]], { error: "country.invalid" }),
});
export type TailoringBrief = z.infer<typeof tailoringBriefSchema>;

export const commissionRequestSchema = z
  .object({
    maisonId: z.uuid(),
    language: z.enum(LANGUAGE_CODES, { error: "language.invalid" }),
    brief: tailoringBriefSchema,
    measurements: measurementsSchema.optional().nullable(),
    /** Consenso esplicito al trattamento delle misure del corpo, visibili solo alla Maison. */
    measurementsConsent: z.boolean().optional(),
    /** Il cliente ha visto l'avviso sui contatti e vuole inviare comunque. */
    confirmContacts: z.boolean().optional(),
  })
  .refine((v) => !hasMeasurements(v.measurements) || v.measurementsConsent === true, {
    path: ["measurementsConsent"],
    message: "measure.consent_required",
  });
export type CommissionRequestInput = z.input<typeof commissionRequestSchema>;

export function hasMeasurements(m: Measurements | null | undefined) {
  return !!m && MEASUREMENTS.some(([k]) => m[k] != null);
}

// --- Conversazione, proposta, accettazione -------------------------------------------------------

export const messageSchema = z.object({
  text: z.string().trim().min(1, "message.empty").max(4000),
  /** Scritto con la dettatura vocale. */
  dictated: z.boolean().optional(),
  confirmContacts: z.boolean().optional(),
});

export const proposalSchema = z.object({
  description: z.string().trim().min(20, "proposal.description_short").max(4000),
  /** Prezzo totale, IVA inclusa, in centesimi. */
  priceCents: z.coerce.number().int().min(100_00, "proposal.price_min").max(1_000_000_00),
  /** Acconto in percentuale sul totale: non rimborsabile da quando inizia la lavorazione. */
  depositPct: z.coerce.number().int().min(20, "proposal.deposit_range").max(70, "proposal.deposit_range"),
  leadTimeWeeks: z.coerce.number().int().min(1, "proposal.weeks_range").max(52, "proposal.weeks_range"),
  fittings: z.coerce.number().int().min(0).max(5),
  confirmContacts: z.boolean().optional(),
});
export type ProposalInput = z.input<typeof proposalSchema>;

/** Indirizzo di consegna internazionale (il carrello resta solo per l'Italia). */
export const deliveryAddressSchema = z
  .object({
    name: z.string().trim().min(2, "address.name").max(120),
    street: z.string().trim().min(4, "address.street").max(200),
    zip: z.string().trim().min(2, "address.zip_any").max(12, "address.zip_any"),
    city: z.string().trim().min(2, "city.invalid").max(120),
    province: z.string().trim().toUpperCase().max(40).optional().default(""),
    country: z.enum(COUNTRY_CODES as [string, ...string[]], { error: "country.invalid" }),
    phone: z.string().trim().max(30),
    notes: z.string().trim().max(300).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.country === "IT") {
      if (!/^\d{5}$/.test(a.zip)) ctx.addIssue({ code: "custom", path: ["zip"], message: "address.zip" });
      if (!PROVINCE_CODES.includes(a.province)) ctx.addIssue({ code: "custom", path: ["province"], message: "province.invalid" });
      if (!isValidMobilePhone(a.phone)) ctx.addIssue({ code: "custom", path: ["phone"], message: "phone.invalid" });
    } else if (!/^\+\d{7,15}$/.test(a.phone.replace(/[\s().-]/g, ""))) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "phone.international" });
    }
  })
  .transform((a) => ({ ...a, phone: a.country === "IT" ? normalizePhone(a.phone) : a.phone.replace(/[\s().-]/g, "") }));
export type DeliveryAddressInput = z.input<typeof deliveryAddressSchema>;

/** Divide il totale in acconto e saldo (centesimi interi, il saldo assorbe l'arrotondamento). */
export function splitDeposit(priceCents: number, depositPct: number) {
  const depositCents = Math.round((priceCents * depositPct) / 100);
  return { depositCents, balanceCents: priceCents - depositCents };
}

// --- Contatti fuori dal portale ------------------------------------------------------------------

export type ContactKind = "email" | "phone" | "iban" | "link" | "app";

/**
 * Riconosce nei testi i recapiti che porterebbero la conversazione fuori dal portale.
 * Serve a un avviso gentile, non a un blocco: il messaggio si può inviare comunque.
 */
export function detectContacts(text: string): ContactKind[] {
  const found = new Set<ContactKind>();
  if (/[A-Z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) found.add("email");
  // Numeri lunghi (le date e le misure restano sotto la soglia), o con il prefisso internazionale.
  for (const m of text.matchAll(/(?:\+|00)?\d[\d\s()-]{6,}\d/g)) {
    const digits = m[0].replace(/\D/g, "").length;
    const international = /^(\+|00)/.test(m[0]);
    if (digits <= 15 && (digits >= 9 || (international && digits >= 8))) found.add("phone");
  }
  if (/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/.test(text.toUpperCase())) found.add("iban");
  if (/(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|it|net|org|me|io|co|uk|de|fr)\b(\/\S*)?/i.test(text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ""))) found.add("link");
  if (/\b(whats\s?app|telegram|instagram|signal|wechat|weixin|skype|messenger|facebook|line\s?id|viber)\b/i.test(text)) found.add("app");
  return [...found];
}

// --- Viste ---------------------------------------------------------------------------------------

export const COMMISSION_STATUSES = [
  "REQUESTED",
  "IN_DIALOGUE",
  "PROPOSED",
  "AGREED",
  "IN_WORK",
  "BALANCE_DUE",
  "DECLINED",
  "EXPIRED",
  "WITHDRAWN",
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/** Fase mostrata alle persone: unisce lo stato della commissione con quello dei pagamenti. */
export type CommissionPhase =
  | "REQUESTED"
  | "IN_DIALOGUE"
  | "PROPOSED"
  | "DEPOSIT_DUE"
  | "DEPOSIT_PAID"
  | "IN_WORK"
  | "BALANCE_DUE"
  | "BALANCE_PAID"
  | "SHIPPED"
  | "COMPLETED"
  | "DISPUTED"
  | "REFUNDED"
  | "DECLINED"
  | "EXPIRED"
  | "WITHDRAWN";

export function commissionPhase(status: CommissionStatus, deposit: OrderStatus | null, balance: OrderStatus | null): CommissionPhase {
  if (status === "AGREED") return deposit === "PAID" ? "DEPOSIT_PAID" : "DEPOSIT_DUE";
  if (status === "BALANCE_DUE") {
    switch (balance) {
      case "PAID":
      case "ACCEPTED":
        return "BALANCE_PAID";
      case "SHIPPED":
        return "SHIPPED";
      case "DELIVERED":
      case "COMPLETED":
        return "COMPLETED";
      case "DISPUTED":
        return "DISPUTED";
      case "REFUNDED":
        return "REFUNDED";
      default:
        return "BALANCE_DUE";
    }
  }
  return status;
}

export type CommissionAction =
  | "MESSAGE"
  | "PROPOSE"
  | "DECLINE"
  | "ACCEPT_PROPOSAL"
  | "REQUEST_CHANGES"
  | "PAY_DEPOSIT"
  | "WITHDRAW"
  | "START_WORK"
  | "LOG_FITTING"
  | "REQUEST_BALANCE"
  | "PAY_BALANCE"
  | "SHIP"
  | "CONFIRM_DELIVERY"
  | "DISPUTE";

export type CommissionEvent =
  | "REQUESTED"
  | "PROPOSAL_SENT"
  | "PROPOSAL_ACCEPTED"
  | "CHANGES_REQUESTED"
  | "DECLINED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "DEPOSIT_PAID"
  | "DEPOSIT_REFUNDED"
  | "WORK_STARTED"
  | "FITTING"
  | "BALANCE_REQUESTED"
  | "BALANCE_PAID"
  | "SHIPPED"
  | "DELIVERED"
  | "DISPUTED";

export interface CommissionMessageView {
  id: string;
  author: "BUYER" | "MAKER" | "SYSTEM";
  mine: boolean;
  kind: "TEXT" | "IMAGE" | "EVENT";
  /** Testo nella lingua di chi guarda (tradotto se serve). */
  text: string | null;
  /** Testo originale, se diverso da quello mostrato. */
  original: string | null;
  originalLanguage: string | null;
  translated: boolean;
  /** La traduzione non è disponibile: si mostra l'originale. */
  untranslated: boolean;
  dictated: boolean;
  image: string | null;
  event: CommissionEvent | null;
  eventData: Record<string, string | number> | null;
  createdAt: string;
}

export interface ProposalView {
  id: string;
  version: number;
  status: "SENT" | "ACCEPTED" | "SUPERSEDED" | "CHANGES_REQUESTED" | "WITHDRAWN";
  description: string;
  original: string | null;
  priceCents: number;
  depositPct: number;
  depositCents: number;
  balanceCents: number;
  leadTimeWeeks: number;
  fittings: number;
  createdAt: string;
}

export interface CommissionView {
  id: string;
  number: string;
  status: CommissionStatus;
  phase: CommissionPhase;
  viewer: "BUYER" | "MAKER";
  /** Lingua in cui chi guarda legge la conversazione. */
  viewerLanguage: string;
  /** Lingua del cliente e lingua della Maison. */
  languages: { buyer: string; maker: string };
  maison: { id: string; slug: string; name: string; city: string; region: string };
  buyer: { displayName: string; country: string };
  brief: TailoringBrief & { descriptionShown: string; descriptionOriginal: string | null };
  /** Visibili solo al cliente e alla Maison. */
  measurements: Measurements | null;
  respondBy: string;
  firstResponseAt: string | null;
  proposals: ProposalView[];
  messages: CommissionMessageView[];
  deliveryAddress: (DeliveryAddressInput & { country: string }) | null;
  deposit: { orderId: string; status: OrderStatus; totalCents: number } | null;
  balance: { orderId: string; status: OrderStatus; totalCents: number; carrier: string | null; trackingCode: string | null; autoReleaseAt: string | null } | null;
  /** Solo per la Maison: commissione del portale e accredito su ogni tappa. */
  payout?: { commissionBps: number };
  workStartedAt: string | null;
  createdAt: string;
  actions: CommissionAction[];
}

export interface CommissionSummary {
  id: string;
  number: string;
  phase: CommissionPhase;
  maison: string;
  buyer: string;
  garment: (typeof GARMENTS)[number];
  respondBy: string;
  answered: boolean;
  unread: number;
  updatedAt: string;
}
