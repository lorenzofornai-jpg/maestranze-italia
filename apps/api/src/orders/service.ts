import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  AUTO_RELEASE_DAYS,
  formatEuro,
  orderInputSchema,
  priceOrder,
  type OrderStatus,
  type OrderView,
  type PricedOrder,
} from "@maestranze/shared";
import type { AuthService, Channel, RequestContext } from "../auth/service";
import type { Config } from "../config";
import type { Db } from "../db/client";
import {
  accounts,
  auditEvents,
  ledgerEntries,
  maisons,
  orderEvents,
  orderItems,
  orders,
  products,
  type Account,
  type Maison,
  type Order,
} from "../db/schema";
import { ApiError, Errors } from "../lib/errors";
import { renderEmail, type Notifier } from "../lib/notifications";
import { parseOrThrow } from "../lib/validation";
import type { PaymentProvider } from "./payments";

type Actor = "BUYER" | "MAKER" | "STAFF" | "SYSTEM";
type Viewer = "BUYER" | "MAKER" | "STAFF";

const DAY = 24 * 60 * 60 * 1000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const T = {
  it: {
    newOrder: (n: string) => `Nuovo ordine ${n}`,
    newOrderBody: (n: string, total: string, buyer: string) =>
      `${buyer} ha ordinato e pagato ${total}. I fondi sono in custodia: accetta l'ordine dall'area riservata e indica la spedizione.`,
    accepted: (n: string) => `Ordine ${n} accettato`,
    acceptedBody: (maison: string) => `${maison} ha accettato il tuo ordine e lo sta preparando.`,
    shipped: (n: string) => `Ordine ${n} spedito`,
    shippedBody: (carrier: string, code: string, days: number) =>
      `Spedito con ${carrier}, codice di tracciamento ${code}. Quando ricevi la merce conferma la consegna: senza segnalazioni, il pagamento alla Maison parte dopo ${days} giorni.`,
    completed: (n: string) => `Ordine ${n}: accredito disposto`,
    completedBody: (amount: string) => `L'ordine è concluso. Abbiamo disposto l'accredito di ${amount}, al netto della commissione.`,
    cancelled: (n: string) => `Ordine ${n} annullato`,
    cancelledBody: (refund: boolean) =>
      refund ? "L'ordine è stato annullato e il pagamento ti è stato rimborsato per intero." : "L'ordine è stato annullato. Nessun addebito.",
    disputed: (n: string) => `Segnalazione sull'ordine ${n}`,
    disputedBody: (note: string) => `Il cliente ha segnalato un problema: «${note}». Lo staff vi contatterà.`,
    refunded: (n: string) => `Ordine ${n} rimborsato`,
    refundedBody: "La segnalazione è stata accolta: il pagamento è stato rimborsato.",
    cta: "Apri l'ordine",
  },
  en: {
    newOrder: (n: string) => `New order ${n}`,
    newOrderBody: (n: string, total: string, buyer: string) =>
      `${buyer} has ordered and paid ${total}. Funds are held in escrow: accept the order from your private area and arrange shipping.`,
    accepted: (n: string) => `Order ${n} accepted`,
    acceptedBody: (maison: string) => `${maison} has accepted your order and is preparing it.`,
    shipped: (n: string) => `Order ${n} shipped`,
    shippedBody: (carrier: string, code: string, days: number) =>
      `Shipped with ${carrier}, tracking code ${code}. When the goods arrive, confirm delivery: without any report, the payment to the Maison is released after ${days} days.`,
    completed: (n: string) => `Order ${n}: payout released`,
    completedBody: (amount: string) => `The order is complete. We have released a payout of ${amount}, net of commission.`,
    cancelled: (n: string) => `Order ${n} cancelled`,
    cancelledBody: (refund: boolean) =>
      refund ? "The order has been cancelled and your payment refunded in full." : "The order has been cancelled. You have not been charged.",
    disputed: (n: string) => `Issue reported on order ${n}`,
    disputedBody: (note: string) => `The client reported an issue: “${note}”. The staff will contact you.`,
    refunded: (n: string) => `Order ${n} refunded`,
    refundedBody: "The report has been upheld: your payment has been refunded.",
    cta: "Open the order",
  },
};
const tx = (l: string) => (l === "en" ? T.en : T.it);

export class OrderService {
  constructor(
    private db: Db,
    private config: Config,
    private notifier: Notifier,
    private auth: AuthService,
    private payments: PaymentProvider,
    private now: () => Date = () => new Date(),
  ) {}

  private isProfessional(a: Account) {
    return a.role === "BUYER" && a.subjectType === "COMPANY";
  }

  private newNumber() {
    const d = this.now();
    const bytes = randomBytes(6);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `MI-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}-${code}`;
  }

  // --- Preventivo e creazione -------------------------------------------------------------------

  /** Ricalcola sempre prezzi, disponibilità e minimi dal database: il carrello del browser non fa fede. */
  async quote(
    buyer: Account,
    input: unknown,
    opts: { requireAddress: boolean } = { requireAddress: true },
  ): Promise<{ priced: PricedOrder; maison: Maison; input: ReturnType<typeof orderInputSchema.parse> }> {
    if (buyer.role !== "BUYER") throw new ApiError(403, "ORDER_BUYERS_ONLY");
    // Per il preventivo l'indirizzo non serve ancora: la cassa mostra i totali mentre lo si compila.
    const data = opts.requireAddress
      ? parseOrThrow(orderInputSchema, input)
      : (parseOrThrow(orderInputSchema.partial({ shippingAddress: true }), input) as ReturnType<typeof orderInputSchema.parse>);
    const maison = await this.db.query.maisons.findFirst({ where: and(eq(maisons.id, data.maisonId), eq(maisons.status, "APPROVED")) });
    if (!maison) throw Errors.notFound();

    const ids = [...new Set(data.items.map((i) => i.productId))];
    const rows = await this.db.query.products.findMany({
      where: and(inArray(products.id, ids), eq(products.maisonId, maison.id), eq(products.active, true)),
    });
    const fields: Record<string, string> = {};
    const lines = data.items.map((item, i) => {
      const p = rows.find((r) => r.id === item.productId);
      if (!p) {
        fields[`items.${i}`] = "order.product_unavailable";
        return null;
      }
      if (item.qty < p.minQty) fields[`items.${i}`] = "order.below_min_qty";
      if (!p.madeToOrder && p.stock != null && item.qty > p.stock) fields[`items.${i}`] = "order.out_of_stock";
      return { productId: p.id, name: p.name, unit: p.unit, qty: item.qty, priceCents: p.priceCents, b2bPriceCents: p.b2bPriceCents, vatRateBps: p.vatRateBps };
    });
    if (Object.keys(fields).length) throw Errors.validation(fields);

    const professional = this.isProfessional(buyer);
    const priced = priceOrder(lines.filter((l) => l !== null), { professional, commissionBps: maison.commissionBps });
    if (professional && maison.b2bMinOrderCents && priced.subtotalCents < maison.b2bMinOrderCents) {
      throw new ApiError(422, "ORDER_BELOW_MINIMUM", undefined, { minimumCents: maison.b2bMinOrderCents });
    }
    return { priced, maison, input: data };
  }

  async create(buyer: Account, input: unknown, channel: Channel, ctx: RequestContext) {
    const { priced, maison, input: data } = await this.quote(buyer, input);
    const number = this.newNumber();
    const order = await this.db.transaction(async (trx) => {
      const [o] = await trx
        .insert(orders)
        .values({
          number,
          buyerAccountId: buyer.id,
          maisonId: maison.id,
          professional: priced.professional,
          subtotalCents: priced.subtotalCents,
          vatCents: priced.vatCents,
          shippingCents: priced.shippingCents,
          totalCents: priced.totalCents,
          commissionBps: priced.commissionBps,
          commissionCents: priced.commissionCents,
          payoutCents: priced.payoutCents,
          shippingAddress: data.shippingAddress,
          note: data.note ?? null,
        })
        .returning();
      await trx.insert(orderItems).values(priced.lines.map((l) => ({ orderId: o!.id, ...l })));
      await trx.insert(orderEvents).values({ orderId: o!.id, status: "AWAITING_AUTHORIZATION", actor: "BUYER" });
      return o!;
    });
    const authorization = await this.newAuthorization(buyer, order, maison, channel, ctx);
    return { order: await this.view(buyer, order.id), authorization };
  }

  private async newAuthorization(buyer: Account, order: Order, maison: Maison, channel: Channel, ctx: RequestContext) {
    const a = await this.auth.createTransactionChallenge(buyer, channel, { orderNumber: order.number, amountCents: order.totalCents, payee: maison.name }, ctx);
    await this.db.update(orders).set({ authChallengeId: a.challengeId, updatedAt: this.now() }).where(eq(orders.id, order.id));
    const { challengeId: _, ...rest } = a;
    return rest;
  }

  private async ownOrder(buyer: Account, orderId: string) {
    const order = await this.db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.buyerAccountId, buyer.id)) });
    if (!order) throw Errors.notFound();
    return order;
  }

  /** Nuova autorizzazione per un ordine non ancora pagato (es. la precedente è scaduta). */
  async reauthorize(buyer: Account, orderId: string, channel: Channel, ctx: RequestContext) {
    const order = await this.ownOrder(buyer, orderId);
    if (order.status !== "AWAITING_AUTHORIZATION") throw new ApiError(409, "ORDER_INVALID_STATE");
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) }))!;
    return this.newAuthorization(buyer, order, maison, channel, ctx);
  }

  // --- Autorizzazione e incasso -------------------------------------------------------------------

  async sendSms(buyer: Account, orderId: string, authToken: unknown) {
    await this.ownOrder(buyer, orderId);
    return this.auth.sendSmsOtp(authToken, "TRANSACTION", buyer.id);
  }

  async startPush(buyer: Account, orderId: string, authToken: unknown) {
    await this.ownOrder(buyer, orderId);
    return this.auth.startPush(authToken, "TRANSACTION", buyer.id);
  }

  async verify(buyer: Account, orderId: string, input: { authToken?: unknown; method?: unknown; code?: unknown }, ctx: RequestContext) {
    const order = await this.ownOrder(buyer, orderId);
    const challengeId = await this.auth.verifyTransaction(input, buyer.id, ctx);
    return this.pay(order, challengeId);
  }

  async pollPush(buyer: Account, orderId: string, authToken: unknown) {
    const order = await this.ownOrder(buyer, orderId);
    const r = await this.auth.pollTransaction(authToken, buyer.id);
    if (r.status !== "APPROVED") return { status: r.status };
    return { status: "APPROVED" as const, order: await this.pay(order, r.challengeId) };
  }

  /**
   * Pagamento autorizzato: scala le disponibilità, incassa e tiene in custodia.
   * La sfida completata deve essere esattamente quella creata per questo ordine.
   */
  private async pay(order: Order, challengeId: string) {
    if (order.authChallengeId !== challengeId) throw Errors.challengeExpired();
    const items = await this.db.query.orderItems.findMany({ where: eq(orderItems.orderId, order.id) });

    // Prenota le quantità: l'aggiornamento riesce solo se la disponibilità basta ancora.
    const reserved: { productId: string; qty: number }[] = [];
    for (const it of items) {
      if (!it.productId) continue;
      const [ok] = await this.db
        .update(products)
        .set({ stock: sql`${products.stock} - ${it.qty}` })
        .where(and(eq(products.id, it.productId), sql`${products.stock} is not null`, gte(products.stock, it.qty)))
        .returning({ id: products.id });
      const p = await this.db.query.products.findFirst({ where: eq(products.id, it.productId) });
      if (ok) reserved.push({ productId: it.productId, qty: it.qty });
      else if (p && p.stock != null && !p.madeToOrder) {
        await this.restock(reserved);
        throw new ApiError(409, "ORDER_OUT_OF_STOCK");
      }
    }

    let chargeRef: string;
    try {
      chargeRef = (await this.payments.charge({ orderNumber: order.number, amountCents: order.totalCents, customerRef: order.buyerAccountId })).ref;
    } catch {
      await this.restock(reserved);
      throw new ApiError(402, "PAYMENT_FAILED");
    }

    const paid = await this.transition(order.id, ["AWAITING_AUTHORIZATION"], "PAID", "SYSTEM", null, {
      paymentProvider: this.payments.name,
      paymentRef: chargeRef,
      paidAt: this.now(),
    });
    if (!paid) {
      // Doppia conferma concorrente: restituisce l'incasso appena fatto.
      await this.payments.refund({ orderNumber: order.number, chargeRef, amountCents: order.totalCents });
      await this.restock(reserved);
      throw new ApiError(409, "ORDER_INVALID_STATE");
    }
    await this.db.insert(ledgerEntries).values({ orderId: order.id, kind: "CHARGE", amountCents: order.totalCents, provider: this.payments.name, providerRef: chargeRef });

    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) }))!;
    const owner = await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) });
    const buyer = await this.db.query.accounts.findFirst({ where: eq(accounts.id, order.buyerAccountId) });
    if (owner && buyer) {
      const t = tx(owner.locale);
      await this.mail(owner, order, t.newOrder(order.number), t.newOrderBody(order.number, formatEuro(order.totalCents, owner.locale), buyer.companyName ?? `${buyer.firstName} ${buyer.lastName}`));
    }
    return this.view(buyer!, order.id);
  }

  private async restock(reserved: { productId: string; qty: number }[]) {
    for (const r of reserved) {
      await this.db.update(products).set({ stock: sql`${products.stock} + ${r.qty}` }).where(eq(products.id, r.productId));
    }
  }

  private async restockOrder(orderId: string) {
    const items = await this.db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) });
    for (const it of items) {
      if (it.productId) {
        await this.db
          .update(products)
          .set({ stock: sql`${products.stock} + ${it.qty}` })
          .where(and(eq(products.id, it.productId), sql`${products.stock} is not null`));
      }
    }
  }

  // --- Ciclo di vita ------------------------------------------------------------------------------

  /** Cambio di stato atomico: riesce solo se l'ordine è ancora in uno degli stati attesi. */
  private async transition(orderId: string, from: OrderStatus[], to: OrderStatus, actor: Actor, note: string | null, extra: Partial<Order> = {}) {
    const [row] = await this.db
      .update(orders)
      .set({ ...extra, status: to, updatedAt: this.now() })
      .where(and(eq(orders.id, orderId), inArray(orders.status, from)))
      .returning();
    if (row) await this.db.insert(orderEvents).values({ orderId, status: to, actor, note });
    return row ?? null;
  }

  private async makerOrder(maker: Account, orderId: string) {
    const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, maker.id) });
    const order = maison ? await this.db.query.orders.findFirst({ where: and(eq(orders.id, orderId), eq(orders.maisonId, maison.id)) }) : null;
    if (!order) throw Errors.notFound();
    return order;
  }

  private stateError(): never {
    throw new ApiError(409, "ORDER_INVALID_STATE");
  }

  async accept(maker: Account, orderId: string) {
    const order = await this.makerOrder(maker, orderId);
    if (!(await this.transition(order.id, ["PAID"], "ACCEPTED", "MAKER", null))) this.stateError();
    const buyer = (await this.db.query.accounts.findFirst({ where: eq(accounts.id, order.buyerAccountId) }))!;
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) }))!;
    const t = tx(buyer.locale);
    await this.mail(buyer, order, t.accepted(order.number), t.acceptedBody(maison.name));
    return this.view(maker, order.id);
  }

  async decline(maker: Account, orderId: string, note: unknown) {
    const order = await this.makerOrder(maker, orderId);
    if (order.status !== "PAID") this.stateError();
    await this.refundAndClose(order, "CANCELLED", "MAKER", typeof note === "string" ? note.slice(0, 500) : null);
    return this.view(maker, order.id);
  }

  async ship(maker: Account, orderId: string, input: { carrier?: unknown; trackingCode?: unknown }) {
    const order = await this.makerOrder(maker, orderId);
    const carrier = typeof input.carrier === "string" ? input.carrier.trim().slice(0, 60) : "";
    const tracking = typeof input.trackingCode === "string" ? input.trackingCode.trim().slice(0, 80) : "";
    const fields: Record<string, string> = {};
    if (carrier.length < 2) fields.carrier = "shipping.carrier_required";
    if (tracking.length < 4) fields.trackingCode = "shipping.tracking_required";
    if (Object.keys(fields).length) throw Errors.validation(fields);
    const row = await this.transition(order.id, ["ACCEPTED"], "SHIPPED", "MAKER", `${carrier} · ${tracking}`, {
      carrier,
      trackingCode: tracking,
      shippedAt: this.now(),
    });
    if (!row) this.stateError();
    const buyer = (await this.db.query.accounts.findFirst({ where: eq(accounts.id, order.buyerAccountId) }))!;
    const t = tx(buyer.locale);
    await this.mail(buyer, order, t.shipped(order.number), t.shippedBody(carrier, tracking, AUTO_RELEASE_DAYS));
    return this.view(maker, order.id);
  }

  async cancel(buyer: Account, orderId: string) {
    const order = await this.ownOrder(buyer, orderId);
    if (order.status === "AWAITING_AUTHORIZATION") {
      if (!(await this.transition(order.id, ["AWAITING_AUTHORIZATION"], "CANCELLED", "BUYER", null))) this.stateError();
    } else if (order.status === "PAID") {
      // Finché la Maison non ha accettato, il cliente può ripensarci con rimborso integrale.
      await this.refundAndClose(order, "CANCELLED", "BUYER", null);
    } else this.stateError();
    return this.view(buyer, order.id);
  }

  async confirmDelivery(buyer: Account, orderId: string) {
    const order = await this.ownOrder(buyer, orderId);
    if (!(await this.transition(order.id, ["SHIPPED"], "DELIVERED", "BUYER", null, { deliveredAt: this.now() }))) this.stateError();
    await this.release(order.id, "BUYER");
    return this.view(buyer, order.id);
  }

  async dispute(buyer: Account, orderId: string, note: unknown) {
    const order = await this.ownOrder(buyer, orderId);
    const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    if (text.length < 10) throw Errors.validation({ note: "dispute.note_required" });
    if (!(await this.transition(order.id, ["ACCEPTED", "SHIPPED"], "DISPUTED", "BUYER", text))) this.stateError();
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) }))!;
    const owner = await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) });
    const staff = await this.db.query.accounts.findMany({ where: eq(accounts.isAdmin, true) });
    for (const to of [owner, ...staff]) {
      if (to) await this.mail(to, order, tx(to.locale).disputed(order.number), tx(to.locale).disputedBody(text));
    }
    return this.view(buyer, order.id);
  }

  /** Lo staff chiude una controversia: rimborso al cliente o rilascio alla Maison. */
  async resolve(staff: Account, orderId: string, input: { decision?: unknown; note?: unknown }) {
    if (!staff.isAdmin) throw Errors.forbidden();
    const order = await this.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order || order.status !== "DISPUTED") this.stateError();
    const note = typeof input.note === "string" ? input.note.slice(0, 1000) : null;
    if (input.decision === "REFUND") await this.refundAndClose(order, "REFUNDED", "STAFF", note);
    else if (input.decision === "RELEASE") {
      if (!(await this.transition(order.id, ["DISPUTED"], "DELIVERED", "STAFF", note, { deliveredAt: this.now() }))) this.stateError();
      await this.release(order.id, "STAFF");
    } else throw Errors.validation({ decision: "decision.invalid" });
    await this.db.insert(auditEvents).values({ accountId: staff.id, type: "order.resolved", meta: { orderId, decision: input.decision } });
    return this.view(staff, order.id);
  }

  /** Rimborso integrale e chiusura, con ripristino delle disponibilità. */
  private async refundAndClose(order: Order, to: "CANCELLED" | "REFUNDED", actor: Actor, note: string | null) {
    const from: OrderStatus[] = to === "CANCELLED" ? ["PAID"] : ["DISPUTED"];
    const row = await this.transition(order.id, from, to, actor, note);
    if (!row) this.stateError();
    const r = await this.payments.refund({ orderNumber: order.number, chargeRef: order.paymentRef!, amountCents: order.totalCents });
    await this.db.insert(ledgerEntries).values({ orderId: order.id, kind: "REFUND", amountCents: order.totalCents, provider: this.payments.name, providerRef: r.ref });
    await this.restockOrder(order.id);
    const buyer = (await this.db.query.accounts.findFirst({ where: eq(accounts.id, order.buyerAccountId) }))!;
    const t = tx(buyer.locale);
    if (to === "REFUNDED") await this.mail(buyer, order, t.refunded(order.number), t.refundedBody);
    else await this.mail(buyer, order, t.cancelled(order.number), t.cancelledBody(true));
  }

  /**
   * Rilascio dei fondi: commissione al portale, il resto alla Maison.
   * Lo stato si blocca prima del trasferimento (mai due accrediti per lo stesso ordine); se il
   * trasferimento fallisce l'ordine torna «consegnato» e si potrà riprovare.
   */
  private async release(orderId: string, actor: Actor) {
    const claimed = await this.transition(orderId, ["DELIVERED"], "COMPLETED", actor === "BUYER" ? "SYSTEM" : actor, null, { completedAt: this.now() });
    if (!claimed) return;
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, claimed.maisonId) }))!;
    let ref: string;
    try {
      ref = (await this.payments.payout({ orderNumber: claimed.number, chargeRef: claimed.paymentRef!, amountCents: claimed.payoutCents, maisonRef: maison.id })).ref;
    } catch {
      await this.transition(orderId, ["COMPLETED"], "DELIVERED", "SYSTEM", "payout_failed", { completedAt: null });
      return;
    }
    await this.db.insert(ledgerEntries).values([
      { orderId, kind: "COMMISSION", amountCents: claimed.commissionCents, provider: this.payments.name },
      { orderId, kind: "PAYOUT", amountCents: claimed.payoutCents, provider: this.payments.name, providerRef: ref },
    ]);
    const owner = await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) });
    if (owner) {
      const t = tx(owner.locale);
      await this.mail(owner, claimed, t.completed(claimed.number), t.completedBody(formatEuro(claimed.payoutCents, owner.locale)));
    }
  }

  /** Senza segnalazioni entro il termine dalla spedizione, i fondi passano alla Maison. */
  async autoRelease() {
    const limit = new Date(this.now().getTime() - AUTO_RELEASE_DAYS * DAY);
    const due = await this.db.query.orders.findMany({ where: and(eq(orders.status, "SHIPPED"), lt(orders.shippedAt, limit)) });
    for (const o of due) {
      if (await this.transition(o.id, ["SHIPPED"], "DELIVERED", "SYSTEM", "auto", { deliveredAt: this.now() })) {
        await this.release(o.id, "SYSTEM");
      }
    }
    return due.length;
  }

  // --- Lettura ------------------------------------------------------------------------------------

  private async viewerOf(account: Account, order: Order): Promise<Viewer | null> {
    if (order.buyerAccountId === account.id) return "BUYER";
    const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) });
    if (maison?.accountId === account.id) return "MAKER";
    if (account.isAdmin) return "STAFF";
    return null;
  }

  async view(account: Account, orderId: string): Promise<OrderView> {
    const order = await this.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) throw Errors.notFound();
    const viewer = await this.viewerOf(account, order);
    if (!viewer) throw Errors.notFound();
    const [maison, buyer, items, events] = await Promise.all([
      this.db.query.maisons.findFirst({ where: eq(maisons.id, order.maisonId) }),
      this.db.query.accounts.findFirst({ where: eq(accounts.id, order.buyerAccountId) }),
      this.db.query.orderItems.findMany({ where: eq(orderItems.orderId, order.id) }),
      this.db.query.orderEvents.findMany({ where: eq(orderEvents.orderId, order.id), orderBy: asc(orderEvents.createdAt) }),
    ]);
    const s = order.status;
    const actions: OrderView["actions"] = [];
    if (viewer === "BUYER") {
      if (s === "AWAITING_AUTHORIZATION") actions.push("AUTHORIZE", "CANCEL");
      if (s === "PAID") actions.push("CANCEL");
      if (s === "SHIPPED") actions.push("CONFIRM_DELIVERY");
      if (s === "ACCEPTED" || s === "SHIPPED") actions.push("DISPUTE");
    }
    if (viewer === "MAKER") {
      if (s === "PAID") actions.push("ACCEPT", "DECLINE");
      if (s === "ACCEPTED") actions.push("SHIP");
    }
    if (viewer === "STAFF" && s === "DISPUTED") actions.push("RESOLVE");
    const seller = viewer !== "BUYER";
    return {
      id: order.id,
      number: order.number,
      status: s,
      professional: order.professional,
      maison: { id: maison!.id, slug: maison!.slug, name: maison!.name },
      buyer: buyer
        ? {
            displayName: buyer.companyName ?? `${buyer.firstName} ${buyer.lastName}`,
            ...(seller ? { email: buyer.email, vatNumber: buyer.vatNumber } : {}),
          }
        : null,
      lines: items.map((i) => ({
        productId: i.productId ?? "",
        name: i.name,
        unit: i.unit,
        qty: i.qty,
        unitNetCents: i.unitNetCents,
        vatRateBps: i.vatRateBps,
        lineNetCents: i.lineNetCents,
        lineVatCents: i.lineVatCents,
      })),
      subtotalCents: order.subtotalCents,
      vatCents: order.vatCents,
      shippingCents: order.shippingCents,
      totalCents: order.totalCents,
      ...(seller ? { commissionCents: order.commissionCents, payoutCents: order.payoutCents } : {}),
      shippingAddress: order.shippingAddress,
      note: order.note,
      carrier: order.carrier,
      trackingCode: order.trackingCode,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      autoReleaseAt: s === "SHIPPED" && order.shippedAt ? new Date(order.shippedAt.getTime() + AUTO_RELEASE_DAYS * DAY).toISOString() : null,
      events: events.map((e) => ({ status: e.status, actor: e.actor, note: e.note, createdAt: e.createdAt.toISOString() })),
      actions,
    };
  }

  /** Elenco per chi guarda: ordini fatti (domanda), ricevuti (offerta), controversie aperte (staff). */
  async list(account: Account) {
    let rows: Order[];
    if (account.role === "MAKER") {
      const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) });
      rows = maison
        ? await this.db.query.orders.findMany({
            where: and(eq(orders.maisonId, maison.id), sql`${orders.status} <> 'AWAITING_AUTHORIZATION'`),
            orderBy: desc(orders.createdAt),
          })
        : [];
    } else {
      rows = await this.db.query.orders.findMany({ where: eq(orders.buyerAccountId, account.id), orderBy: desc(orders.createdAt) });
    }
    const disputes = account.isAdmin ? await this.db.query.orders.findMany({ where: eq(orders.status, "DISPUTED"), orderBy: desc(orders.updatedAt) }) : [];
    const maisonIds = [...new Set([...rows, ...disputes].map((o) => o.maisonId))];
    const ms = maisonIds.length ? await this.db.query.maisons.findMany({ where: inArray(maisons.id, maisonIds) }) : [];
    const brief = (o: Order) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
      maison: ms.find((m) => m.id === o.maisonId)?.name ?? "",
    });
    return { orders: rows.map(brief), disputes: disputes.map(brief) };
  }

  private async mail(to: Account, order: Order, subject: string, body: string) {
    const url = `${this.config.WEB_ORIGIN}/${to.locale}/area/ordini/${order.id}`;
    await this.notifier.email({
      to: to.email,
      subject,
      ...renderEmail({ locale: to.locale, title: subject, body, cta: { label: tx(to.locale).cta, url } }),
    });
  }
}
