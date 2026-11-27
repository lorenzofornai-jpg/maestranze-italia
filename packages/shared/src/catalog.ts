import { z } from "zod";
import { PROVINCE_CODES, REGIONS } from "./territory";

export const DISCIPLINES = ["FOOD", "BEVERAGE", "TAILORING", "SPORT", "CRAFTS"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const MAISON_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type MaisonStatus = (typeof MAISON_STATUSES)[number];

export const PRODUCT_UNITS = ["PIECE", "KG", "BOTTLE", "CASE", "METRE", "SET"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Riconoscimenti che una Maison può dichiarare (verificati in fase di selezione). */
export const CERTIFICATIONS = [
  "DOP",
  "IGP",
  "STG",
  "DOC",
  "DOCG",
  "BIO",
  "SLOW_FOOD",
  "BOTTEGA_STORICA",
  "MADE_IN_ITALY_100",
  "ARTIGIANATO_ARTISTICO",
] as const;

export type I18nText = { it: string; en?: string };

/** Aliquote IVA italiane in punti base. Alimentari 4/10%, la maggior parte dei beni 22%. */
export const VAT_RATES = [400, 500, 1000, 2200] as const;

/** Testo nella lingua richiesta, con l'italiano come riserva. */
export const pick = (text: I18nText | null | undefined, locale: string): string =>
  !text ? "" : locale === "en" && text.en?.trim() ? text.en : text.it;

export function regionOf(province: string): string | undefined {
  return Object.entries(REGIONS).find(([, list]) => list.some(([code]) => code === province))?.[0];
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const i18n = (min: number, max: number) =>
  z.object({
    it: z.string().trim().min(min, "text.too_short").max(max, "text.too_long"),
    en: z.string().trim().max(max, "text.too_long").optional().default(""),
  });

export const maisonSchema = z.object({
  name: z.string().trim().min(2, "maison.name_required").max(80),
  discipline: z.enum(DISCIPLINES, { error: "discipline.invalid" }),
  tagline: i18n(4, 140),
  story: i18n(80, 4000),
  craft: i18n(0, 2000).optional(),
  foundedYear: z.coerce
    .number()
    .int()
    .min(1000, "year.invalid")
    .max(new Date().getFullYear(), "year.invalid")
    .optional()
    .nullable(),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => PROVINCE_CODES.includes(v), "province.invalid"),
  city: z.string().trim().min(2, "city.invalid").max(120),
  certifications: z.array(z.enum(CERTIFICATIONS)).max(10).default([]),
  b2bMinOrderCents: z.coerce.number().int().min(0).max(100_000_00).optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional().nullable(),
  /** Accetta commissioni su misura nell'Atelier (per ora solo sartoria). */
  acceptsCommissions: z.boolean().optional(),
});
export type MaisonInput = z.input<typeof maisonSchema>;

export const productSchema = z
  .object({
    name: i18n(2, 120),
    description: i18n(20, 3000),
    priceCents: z.coerce.number().int("price.invalid").min(100, "price.invalid").max(10_000_000, "price.invalid"),
    b2bPriceCents: z.coerce.number().int().min(100, "price.invalid").max(10_000_000).optional().nullable(),
    unit: z.enum(PRODUCT_UNITS).default("PIECE"),
    minQty: z.coerce.number().int().min(1).max(10_000).default(1),
    stock: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
    madeToOrder: z.boolean().default(false),
    active: z.boolean().default(true),
    vatRateBps: z.coerce
      .number()
      .refine((v) => (VAT_RATES as readonly number[]).includes(v), "vat_rate.invalid")
      .default(2200),
  })
  .refine((p) => p.b2bPriceCents == null || p.b2bPriceCents <= p.priceCents, {
    path: ["b2bPriceCents"],
    message: "price.b2b_higher",
  });
export type ProductInput = z.input<typeof productSchema>;

/** Prodotto come lo vede il pubblico (o un cliente professionale, con il suo prezzo riservato). */
export interface PublicProduct {
  id: string;
  slug: string;
  name: I18nText;
  description: I18nText;
  priceCents: number;
  b2bPriceCents: number | null;
  unit: ProductUnit;
  minQty: number;
  available: boolean;
  madeToOrder: boolean;
  vatRateBps: number;
  image: string | null;
}

export interface PublicMaison {
  id: string;
  slug: string;
  name: string;
  discipline: Discipline;
  tagline: I18nText;
  story: I18nText;
  craft: I18nText | null;
  foundedYear: number | null;
  region: string;
  province: string;
  city: string;
  certifications: string[];
  b2bMinOrderCents: number | null;
  leadTimeDays: number | null;
  coverImage: string | null;
  /** Si può richiedere una commissione su misura (Atelier). */
  acceptsCommissions: boolean;
  productCount?: number;
  products?: PublicProduct[];
}

export const formatEuro = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
