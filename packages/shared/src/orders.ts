import { z } from "zod";
import type { I18nText, ProductUnit } from "./catalog";
import { PROVINCE_CODES } from "./territory";
import { isValidMobilePhone, normalizePhone } from "./validators";

export const ORDER_STATUSES = [
  "AWAITING_AUTHORIZATION",
  "PAID",
  "ACCEPTED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "DISPUTED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Giorni dopo la spedizione oltre i quali, senza segnalazioni, i fondi vengono rilasciati alla Maison. */
export const AUTO_RELEASE_DAYS = 14;

export const shippingAddressSchema = z.object({
  name: z.string().trim().min(2, "address.name").max(120),
  street: z.string().trim().min(4, "address.street").max(200),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "address.zip"),
  city: z.string().trim().min(2, "city.invalid").max(120),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => PROVINCE_CODES.includes(v), "province.invalid"),
  country: z.literal("IT").default("IT"),
  phone: z.string().refine(isValidMobilePhone, "phone.invalid").transform(normalizePhone),
  notes: z.string().trim().max(300).optional(),
});
export type ShippingAddressInput = z.input<typeof shippingAddressSchema>;

export const orderInputSchema = z.object({
  maisonId: z.uuid(),
  items: z
    .array(z.object({ productId: z.uuid(), qty: z.coerce.number().int().min(1).max(100_000) }))
    .min(1, "order.empty")
    .max(50),
  shippingAddress: shippingAddressSchema,
  note: z.string().trim().max(1000).optional(),
});
export type OrderInput = z.input<typeof orderInputSchema>;

export interface PricedLine {
  productId: string;
  name: I18nText;
  unit: ProductUnit;
  qty: number;
  unitNetCents: number;
  vatRateBps: number;
  lineNetCents: number;
  lineVatCents: number;
}

export interface PricedOrder {
  professional: boolean;
  lines: PricedLine[];
  subtotalCents: number;
  vatCents: number;
  shippingCents: number;
  totalCents: number;
  commissionBps: number;
  commissionCents: number;
  payoutCents: number;
}

/**
 * Calcolo degli importi, in centesimi interi.
 * - Cliente privato: il prezzo di listino è IVA inclusa; netto e IVA si ricavano per scorporo.
 * - Cliente professionale: prezzo riservato netto (o, se manca, il listino scorporato) + IVA.
 * La commissione del portale si calcola sul totale pagato; il resto è l'accredito alla Maison.
 */
export function priceOrder(
  lines: { productId: string; name: I18nText; unit: ProductUnit; qty: number; priceCents: number; b2bPriceCents: number | null; vatRateBps: number }[],
  opts: { professional: boolean; commissionBps: number; shippingCents?: number },
): PricedOrder {
  const priced = lines.map((l) => {
    const scorporo = (gross: number) => Math.round((gross * 10_000) / (10_000 + l.vatRateBps));
    if (opts.professional) {
      const unitNet = l.b2bPriceCents ?? scorporo(l.priceCents);
      const lineNet = unitNet * l.qty;
      return { ...pickLine(l), unitNetCents: unitNet, lineNetCents: lineNet, lineVatCents: Math.round((lineNet * l.vatRateBps) / 10_000) };
    }
    const lineGross = l.priceCents * l.qty;
    const lineNet = scorporo(lineGross);
    return { ...pickLine(l), unitNetCents: scorporo(l.priceCents), lineNetCents: lineNet, lineVatCents: lineGross - lineNet };
  });
  const subtotal = priced.reduce((n, l) => n + l.lineNetCents, 0);
  const vat = priced.reduce((n, l) => n + l.lineVatCents, 0);
  const shipping = opts.shippingCents ?? 0;
  const total = subtotal + vat + shipping;
  const commission = Math.round((total * opts.commissionBps) / 10_000);
  return {
    professional: opts.professional,
    lines: priced,
    subtotalCents: subtotal,
    vatCents: vat,
    shippingCents: shipping,
    totalCents: total,
    commissionBps: opts.commissionBps,
    commissionCents: commission,
    payoutCents: total - commission,
  };
}

function pickLine(l: { productId: string; name: I18nText; unit: ProductUnit; qty: number; vatRateBps: number }) {
  return { productId: l.productId, name: l.name, unit: l.unit, qty: l.qty, vatRateBps: l.vatRateBps };
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  professional: boolean;
  maison: { id: string; slug: string; name: string };
  buyer: { displayName: string; email?: string; vatNumber?: string | null } | null;
  lines: PricedLine[];
  subtotalCents: number;
  vatCents: number;
  shippingCents: number;
  totalCents: number;
  /** Solo per la Maison e lo staff. */
  commissionCents?: number;
  payoutCents?: number;
  shippingAddress: Omit<ShippingAddressInput, "country"> & { country: string };
  note: string | null;
  carrier: string | null;
  trackingCode: string | null;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  autoReleaseAt: string | null;
  events: { status: OrderStatus; actor: string; note: string | null; createdAt: string }[];
  /** Azioni disponibili per chi guarda, già calcolate dal server. */
  actions: ("AUTHORIZE" | "CANCEL" | "ACCEPT" | "DECLINE" | "SHIP" | "CONFIRM_DELIVERY" | "DISPUTE" | "RESOLVE")[];
}
