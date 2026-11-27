import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  AUTO_RELEASE_DAYS,
  COMMISSION_RESPONSE_HOURS,
  commissionPhase,
  commissionRequestSchema,
  deliveryAddressSchema,
  detectContacts,
  formatEuro,
  hasMeasurements,
  messageSchema,
  proposalSchema,
  splitDeposit,
  type CommissionAction,
  type CommissionEvent,
  type CommissionMessageView,
  type CommissionStatus,
  type CommissionSummary,
  type CommissionView,
  type Measurements,
  type ProposalView,
  type TailoringBrief,
} from "@maestranze/shared";
import type { Channel, RequestContext } from "../auth/service";
import type { Config } from "../config";
import type { Db } from "../db/client";
import {
  accounts,
  auditEvents,
  commissionMessages,
  commissionProposals,
  commissions,
  maisons,
  orders,
  type Account,
  type Commission,
  type CommissionMessage,
  type Maison,
  type Order,
  type ShippingAddress,
} from "../db/schema";
import { ApiError, Errors } from "../lib/errors";
import type { PrivateFiles } from "../lib/media";
import { renderEmail, type Notifier } from "../lib/notifications";
import type { Translator } from "../lib/translate";
import { parseOrThrow } from "../lib/validation";
import type { OrderService } from "../orders/service";

type Party = "BUYER" | "MAKER";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Tra due email per nuovi messaggi alla stessa persona, sulla stessa commissione. */
const MESSAGE_MAIL_GAP_MS = 15 * 60 * 1000;
/** Richieste ancora senza risposta che un cliente può avere aperte insieme. */
const MAX_OPEN_REQUESTS = 10;
const OPEN: CommissionStatus[] = ["REQUESTED", "IN_DIALOGUE", "PROPOSED"];

const T = {
  it: {
    requested: (n: string) => `Nuova richiesta su misura ${n}`,
    requestedBody: (buyer: string, hours: number) =>
      `${buyer} ti ha scritto nell'Atelier per una commissione su misura. Rispondi entro ${hours} ore: con un messaggio o con una proposta.`,
    message: (n: string) => `Nuovo messaggio nell'Atelier · ${n}`,
    messageBody: (from: string) => `${from} ti ha scritto. Il messaggio è già tradotto nella tua lingua.`,
    proposal: (n: string) => `La proposta per la tua commissione ${n}`,
    proposalBody: (maison: string, total: string) => `${maison} ti ha inviato una proposta: ${total}, IVA inclusa. La trovi nell'Atelier.`,
    accepted: (n: string) => `Proposta accettata · ${n}`,
    acceptedBody: (buyer: string) => `${buyer} ha accettato la tua proposta. Appena l'acconto è versato potrai iniziare la lavorazione.`,
    changes: (n: string) => `Richiesta di modifiche · ${n}`,
    changesBody: (buyer: string) => `${buyer} vorrebbe modificare la proposta: trovi i dettagli nell'Atelier.`,
    depositPaid: (n: string) => `Acconto versato · ${n}`,
    depositPaidBody: (amount: string) => `Il cliente ha versato l'acconto di ${amount}. Quando inizi la lavorazione, segnalalo nell'Atelier: l'acconto ti viene accreditato.`,
    workStarted: (n: string) => `La lavorazione è iniziata · ${n}`,
    workStartedBody: (maison: string) => `${maison} ha iniziato a lavorare alla tua commissione. Da questo momento l'acconto non è più rimborsabile.`,
    balance: (n: string) => `Il saldo della tua commissione ${n}`,
    balanceBody: (maison: string, amount: string) => `${maison} ha completato la lavorazione e ti chiede il saldo di ${amount}. Dopo il pagamento, l'opera viene spedita.`,
    balancePaid: (n: string) => `Saldo versato · ${n}`,
    balancePaidBody: (amount: string) => `Il cliente ha versato il saldo di ${amount}, in custodia fino alla consegna. Puoi spedire e indicare il tracciamento nell'Atelier.`,
    declined: (n: string) => `Commissione ${n}`,
    declinedBody: (maison: string) => `${maison} non può accettare questa commissione. Puoi scrivere ad altre Maison della stessa arte.`,
    withdrawn: (n: string) => `Commissione ${n} ritirata`,
    withdrawnBody: (buyer: string, refunded: boolean) => `${buyer} ha ritirato la richiesta.${refunded ? " L'acconto gli è stato rimborsato per intero." : ""}`,
    expired: (n: string) => `Richiesta ${n} scaduta`,
    expiredBuyer: (maison: string, hours: number) =>
      `${maison} non ha risposto entro ${hours} ore e la richiesta è stata chiusa. Puoi rivolgerti a un'altra Maison: il brief resta nel tuo Atelier.`,
    expiredMaker: (hours: number) => `La richiesta è stata chiusa perché non ha ricevuto risposta entro ${hours} ore.`,
    cta: "Apri l'Atelier",
  },
  en: {
    requested: (n: string) => `New bespoke request ${n}`,
    requestedBody: (buyer: string, hours: number) =>
      `${buyer} has written to you in the Atelier about a bespoke commission. Please reply within ${hours} hours, with a message or a proposal.`,
    message: (n: string) => `New message in the Atelier · ${n}`,
    messageBody: (from: string) => `${from} has written to you. The message is already translated into your language.`,
    proposal: (n: string) => `The proposal for your commission ${n}`,
    proposalBody: (maison: string, total: string) => `${maison} has sent you a proposal: ${total}, VAT included. You will find it in the Atelier.`,
    accepted: (n: string) => `Proposal accepted · ${n}`,
    acceptedBody: (buyer: string) => `${buyer} has accepted your proposal. Once the deposit is paid you can start work.`,
    changes: (n: string) => `Changes requested · ${n}`,
    changesBody: (buyer: string) => `${buyer} would like to change the proposal: details are in the Atelier.`,
    depositPaid: (n: string) => `Deposit paid · ${n}`,
    depositPaidBody: (amount: string) => `The client has paid the deposit of ${amount}. When you start work, mark it in the Atelier: the deposit is then paid out to you.`,
    workStarted: (n: string) => `Work has begun · ${n}`,
    workStartedBody: (maison: string) => `${maison} has started work on your commission. From now on the deposit is non-refundable.`,
    balance: (n: string) => `The balance for your commission ${n}`,
    balanceBody: (maison: string, amount: string) => `${maison} has completed the work and requests the balance of ${amount}. Once paid, the piece will be shipped.`,
    balancePaid: (n: string) => `Balance paid · ${n}`,
    balancePaidBody: (amount: string) => `The client has paid the balance of ${amount}, held in escrow until delivery. You can ship and add tracking in the Atelier.`,
    declined: (n: string) => `Commission ${n}`,
    declinedBody: (maison: string) => `${maison} is unable to take on this commission. You can write to other Maisons in the same craft.`,
    withdrawn: (n: string) => `Commission ${n} withdrawn`,
    withdrawnBody: (buyer: string, refunded: boolean) => `${buyer} has withdrawn the request.${refunded ? " The deposit has been refunded in full." : ""}`,
    expired: (n: string) => `Request ${n} closed`,
    expiredBuyer: (maison: string, hours: number) =>
      `${maison} did not reply within ${hours} hours and the request has been closed. You can turn to another Maison: your brief stays in your Atelier.`,
    expiredMaker: (hours: number) => `The request has been closed because it received no reply within ${hours} hours.`,
    cta: "Open the Atelier",
  },
};
const tx = (l: string) => (l === "en" ? T.en : T.it);

const displayName = (a: Account) => a.companyName ?? `${a.firstName} ${a.lastName}`;

export class AtelierService {
  constructor(
    private db: Db,
    private config: Config,
    private notifier: Notifier,
    private orders: OrderService,
    private translator: Translator,
    private files: PrivateFiles,
    private now: () => Date = () => new Date(),
  ) {
    orders.onCommissionPaid = (order) => this.stagePaid(order);
  }

  private newNumber() {
    const d = this.now();
    const code = Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `AT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}-${code}`;
  }

  // --- Accesso ------------------------------------------------------------------------------------

  private async load(account: Account, id: string) {
    const c = await this.db.query.commissions.findFirst({ where: eq(commissions.id, id) });
    if (!c) throw Errors.notFound();
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, c.maisonId) }))!;
    let party: Party | null = null;
    if (c.buyerAccountId === account.id) party = "BUYER";
    else if (maison.accountId === account.id) party = "MAKER";
    if (!party) throw Errors.notFound();
    const [buyer, maker] = await Promise.all([
      this.db.query.accounts.findFirst({ where: eq(accounts.id, c.buyerAccountId) }),
      this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) }),
    ]);
    return { c, maison, party, buyer: buyer!, maker: maker! };
  }

  private async as(account: Account, id: string, party: Party) {
    const ctx = await this.load(account, id);
    if (ctx.party !== party) throw Errors.forbidden();
    return ctx;
  }

  private stateError(): never {
    throw new ApiError(409, "COMMISSION_INVALID_STATE");
  }

  /** Cambio di stato atomico: riesce solo se la commissione è ancora in uno degli stati attesi. */
  private async move(id: string, from: CommissionStatus[], to: CommissionStatus, extra: Partial<Commission> = {}) {
    const [row] = await this.db
      .update(commissions)
      .set({ ...extra, status: to, updatedAt: this.now() })
      .where(and(eq(commissions.id, id), inArray(commissions.status, from)))
      .returning();
    if (!row) this.stateError();
    return row;
  }

  private checkContacts(text: string, confirmed: boolean | undefined) {
    const kinds = detectContacts(text);
    if (kinds.length && !confirmed) throw new ApiError(409, "CONTACT_WARNING", undefined, { kinds });
    return kinds.length > 0;
  }

  private langOf(party: Party, c: Commission, maker: Account) {
    return party === "BUYER" ? c.language : maker.locale;
  }

  private async translateInto(text: string, from: string, to: string, discipline: string) {
    if (from === to || !this.translator.enabled) return {};
    const out = await this.translator.translate(text, to, { discipline });
    return out ? { [to]: out } : {};
  }

  private async event(commissionId: string, event: CommissionEvent, data?: Record<string, string | number>) {
    await this.db.insert(commissionMessages).values({ commissionId, author: "SYSTEM", kind: "EVENT", event, eventData: data ?? null });
    await this.db.update(commissions).set({ updatedAt: this.now() }).where(eq(commissions.id, commissionId));
  }

  private async mail(to: Account, c: Commission, subject: string, body: string) {
    const url = `${this.config.WEB_ORIGIN}/${to.locale}/area/atelier/${c.id}`;
    await this.notifier.email({
      to: to.email,
      subject,
      ...renderEmail({ locale: to.locale, title: subject, body, cta: { label: tx(to.locale).cta, url } }),
    });
  }

  // --- Richiesta ----------------------------------------------------------------------------------

  async request(buyer: Account, input: unknown) {
    if (buyer.role !== "BUYER") throw new ApiError(403, "COMMISSION_BUYERS_ONLY");
    const data = parseOrThrow(commissionRequestSchema, input);
    const maison = await this.db.query.maisons.findFirst({ where: and(eq(maisons.id, data.maisonId), eq(maisons.status, "APPROVED")) });
    if (!maison || maison.discipline !== "TAILORING" || !maison.acceptsCommissions) throw Errors.notFound();
    const [{ open }] = (await this.db
      .select({ open: sql<number>`count(*)::int` })
      .from(commissions)
      .where(and(eq(commissions.buyerAccountId, buyer.id), eq(commissions.status, "REQUESTED")))) as [{ open: number }];
    if (open >= MAX_OPEN_REQUESTS) throw new ApiError(429, "COMMISSION_TOO_MANY_OPEN");
    const flagged = this.checkContacts(data.brief.description, data.confirmContacts);

    const maker = (await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) }))!;
    const measured = hasMeasurements(data.measurements);
    const translations = await this.translateInto(data.brief.description, data.language, maker.locale, maison.discipline);
    const now = this.now();
    const [c] = await this.db
      .insert(commissions)
      .values({
        number: this.newNumber(),
        buyerAccountId: buyer.id,
        maisonId: maison.id,
        language: data.language,
        brief: data.brief,
        briefTranslations: translations,
        measurements: measured ? data.measurements! : null,
        measurementsConsentAt: measured ? now : null,
        respondBy: new Date(now.getTime() + COMMISSION_RESPONSE_HOURS * HOUR),
        buyerReadAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.event(c!.id, "REQUESTED");
    if (flagged) await this.db.insert(auditEvents).values({ accountId: buyer.id, type: "atelier.contact_in_brief", meta: { commissionId: c!.id } });
    const t = tx(maker.locale);
    await this.mail(maker, c!, t.requested(c!.number), t.requestedBody(displayName(buyer), COMMISSION_RESPONSE_HOURS));
    await this.db.update(commissions).set({ makerNotifiedAt: now }).where(eq(commissions.id, c!.id));
    return { id: c!.id, number: c!.number };
  }

  // --- Conversazione ------------------------------------------------------------------------------

  /** La prima risposta della Maison ferma l'orologio delle 96 ore. */
  private async markAnswered(c: Commission) {
    if (c.firstResponseAt) return;
    await this.db
      .update(commissions)
      .set({ firstResponseAt: this.now() })
      .where(and(eq(commissions.id, c.id), isNull(commissions.firstResponseAt)));
    await this.db
      .update(commissions)
      .set({ status: "IN_DIALOGUE" })
      .where(and(eq(commissions.id, c.id), eq(commissions.status, "REQUESTED")));
  }

  private writable(c: Commission) {
    if (c.status === "DECLINED" || c.status === "EXPIRED" || c.status === "WITHDRAWN") this.stateError();
  }

  async message(account: Account, id: string, input: unknown) {
    const { c, maison, party, buyer, maker } = await this.load(account, id);
    this.writable(c);
    const data = parseOrThrow(messageSchema, input);
    const flagged = this.checkContacts(data.text, data.confirmContacts);
    const from = this.langOf(party, c, maker);
    const to = this.langOf(party === "BUYER" ? "MAKER" : "BUYER", c, maker);
    const translations = await this.translateInto(data.text, from, to, maison.discipline);
    await this.db.insert(commissionMessages).values({
      commissionId: c.id,
      author: party,
      authorAccountId: account.id,
      kind: "TEXT",
      body: data.text,
      language: from,
      translations,
      dictated: data.dictated ?? false,
      contactFlag: flagged,
    });
    if (party === "MAKER") await this.markAnswered(c);
    await this.touched(c, party, buyer, maker, maison);
    return this.view(account, id);
  }

  async image(account: Account, id: string, data: Buffer) {
    const { c, maison, party, buyer, maker } = await this.load(account, id);
    this.writable(c);
    const key = await this.files.saveImage(data);
    await this.db.insert(commissionMessages).values({ commissionId: c.id, author: party, authorAccountId: account.id, kind: "IMAGE", attachment: key });
    if (party === "MAKER") await this.markAnswered(c);
    await this.touched(c, party, buyer, maker, maison);
    return this.view(account, id);
  }

  async file(account: Account, id: string, key: string) {
    const { c } = await this.load(account, id);
    const msg = await this.db.query.commissionMessages.findFirst({ where: and(eq(commissionMessages.commissionId, c.id), eq(commissionMessages.attachment, key)) });
    if (!msg) throw Errors.notFound();
    const f = await this.files.read(key);
    if (!f) throw Errors.notFound();
    return f;
  }

  /** Aggiorna lettura e avvisa l'altra parte via email, senza inondarla. */
  private async touched(c: Commission, party: Party, buyer: Account, maker: Account, maison: Maison) {
    const now = this.now();
    const to = party === "BUYER" ? maker : buyer;
    const last = party === "BUYER" ? c.makerNotifiedAt : c.buyerNotifiedAt;
    const notify = !last || now.getTime() - last.getTime() > MESSAGE_MAIL_GAP_MS;
    await this.db
      .update(commissions)
      .set({
        updatedAt: now,
        ...(party === "BUYER" ? { buyerReadAt: now } : { makerReadAt: now }),
        ...(notify ? (party === "BUYER" ? { makerNotifiedAt: now } : { buyerNotifiedAt: now }) : {}),
      })
      .where(eq(commissions.id, c.id));
    if (notify) {
      const t = tx(to.locale);
      await this.mail(to, c, t.message(c.number), t.messageBody(party === "BUYER" ? displayName(buyer) : maison.name));
    }
  }

  // --- Proposta -----------------------------------------------------------------------------------

  async propose(maker: Account, id: string, input: unknown) {
    const { c, maison, buyer } = await this.as(maker, id, "MAKER");
    if (!OPEN.includes(c.status)) this.stateError();
    const data = parseOrThrow(proposalSchema, input);
    this.checkContacts(data.description, data.confirmContacts);
    const { depositCents } = splitDeposit(data.priceCents, data.depositPct);
    const translations = await this.translateInto(data.description, maker.locale, c.language, maison.discipline);
    const previous = await this.db.query.commissionProposals.findMany({ where: eq(commissionProposals.commissionId, c.id) });
    await this.db
      .update(commissionProposals)
      .set({ status: "SUPERSEDED" })
      .where(and(eq(commissionProposals.commissionId, c.id), eq(commissionProposals.status, "SENT")));
    const version = previous.length + 1;
    await this.db.insert(commissionProposals).values({
      commissionId: c.id,
      version,
      description: data.description,
      language: maker.locale,
      translations,
      priceCents: data.priceCents,
      depositPct: data.depositPct,
      depositCents,
      leadTimeWeeks: data.leadTimeWeeks,
      fittings: data.fittings,
    });
    await this.markAnswered(c);
    await this.move(c.id, OPEN, "PROPOSED", { makerReadAt: this.now() });
    await this.event(c.id, "PROPOSAL_SENT", { version, totalCents: data.priceCents });
    const t = tx(buyer.locale);
    await this.mail(buyer, c, t.proposal(c.number), t.proposalBody(maison.name, formatEuro(data.priceCents, buyer.locale)));
    return this.view(maker, id);
  }

  async decline(maker: Account, id: string, note: unknown) {
    const { c, maison, buyer } = await this.as(maker, id, "MAKER");
    const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    await this.markAnswered(c);
    await this.move(c.id, OPEN, "DECLINED");
    await this.db
      .update(commissionProposals)
      .set({ status: "WITHDRAWN" })
      .where(and(eq(commissionProposals.commissionId, c.id), eq(commissionProposals.status, "SENT")));
    if (text) {
      const translations = await this.translateInto(text, maker.locale, c.language, maison.discipline);
      await this.db.insert(commissionMessages).values({ commissionId: c.id, author: "MAKER", authorAccountId: maker.id, kind: "TEXT", body: text, language: maker.locale, translations });
    }
    await this.event(c.id, "DECLINED");
    const t = tx(buyer.locale);
    await this.mail(buyer, c, t.declined(c.number), t.declinedBody(maison.name));
    return this.view(maker, id);
  }

  private async currentProposal(c: Commission) {
    const p = await this.db.query.commissionProposals.findFirst({
      where: and(eq(commissionProposals.commissionId, c.id), eq(commissionProposals.status, "SENT")),
    });
    if (!p) this.stateError();
    return p;
  }

  async requestChanges(buyer: Account, id: string, note: unknown) {
    const { c, maison, maker } = await this.as(buyer, id, "BUYER");
    if (c.status !== "PROPOSED") this.stateError();
    const p = await this.currentProposal(c);
    const text = typeof note === "string" ? note.trim().slice(0, 4000) : "";
    if (text.length < 5) throw Errors.validation({ note: "changes.note_required" });
    await this.move(c.id, ["PROPOSED"], "IN_DIALOGUE", { buyerReadAt: this.now() });
    await this.db.update(commissionProposals).set({ status: "CHANGES_REQUESTED", respondedAt: this.now() }).where(eq(commissionProposals.id, p.id));
    await this.event(c.id, "CHANGES_REQUESTED", { version: p.version });
    const translations = await this.translateInto(text, c.language, maker.locale, maison.discipline);
    await this.db.insert(commissionMessages).values({ commissionId: c.id, author: "BUYER", authorAccountId: buyer.id, kind: "TEXT", body: text, language: c.language, translations });
    const t = tx(maker.locale);
    await this.mail(maker, c, t.changes(c.number), t.changesBody(displayName(buyer)));
    return this.view(buyer, id);
  }

  /** Il cliente accetta: indirizzo di consegna, poi l'acconto con autorizzazione forte. */
  async acceptProposal(buyer: Account, id: string, input: { address?: unknown }, channel: Channel, ctx: RequestContext) {
    const { c, maison, maker } = await this.as(buyer, id, "BUYER");
    if (c.status !== "PROPOSED") this.stateError();
    const p = await this.currentProposal(c);
    const address = parseOrThrow(deliveryAddressSchema, input.address ?? {}) as ShippingAddress;
    await this.move(c.id, ["PROPOSED"], "AGREED", { deliveryAddress: address, buyerReadAt: this.now() });
    await this.db.update(commissionProposals).set({ status: "ACCEPTED", respondedAt: this.now() }).where(eq(commissionProposals.id, p.id));
    await this.event(c.id, "PROPOSAL_ACCEPTED", { version: p.version, totalCents: p.priceCents });
    const t = tx(maker.locale);
    await this.mail(maker, c, t.accepted(c.number), t.acceptedBody(displayName(buyer)));
    const payment = await this.orders.createCommissionOrder(
      buyer,
      maison,
      { commissionId: c.id, stage: "DEPOSIT", name: this.stageName("DEPOSIT", c), grossCents: p.depositCents, address },
      channel,
      ctx,
    );
    await this.db.update(commissions).set({ depositOrderId: payment.order.id }).where(eq(commissions.id, c.id));
    return payment;
  }

  private stageName(stage: "DEPOSIT" | "BALANCE", c: Commission) {
    return stage === "DEPOSIT"
      ? { it: `Acconto · commissione ${c.number}`, en: `Deposit · commission ${c.number}` }
      : { it: `Saldo · commissione ${c.number}`, en: `Balance · commission ${c.number}` };
  }

  /** Nuova autorizzazione per una tappa non ancora pagata (es. la precedente è scaduta). */
  async payDeposit(buyer: Account, id: string, channel: Channel, ctx: RequestContext) {
    const { c } = await this.as(buyer, id, "BUYER");
    if (c.status !== "AGREED" || !c.depositOrderId) this.stateError();
    return this.reauthorize(buyer, c.depositOrderId, channel, ctx);
  }

  private async reauthorize(buyer: Account, orderId: string, channel: Channel, ctx: RequestContext) {
    const authorization = await this.orders.reauthorize(buyer, orderId, channel, ctx);
    return { order: await this.orders.view(buyer, orderId), authorization };
  }

  async withdraw(buyer: Account, id: string) {
    const { c, maker } = await this.as(buyer, id, "BUYER");
    const row = await this.move(c.id, [...OPEN, "AGREED"], "WITHDRAWN");
    await this.db
      .update(commissionProposals)
      .set({ status: "WITHDRAWN" })
      .where(and(eq(commissionProposals.commissionId, c.id), eq(commissionProposals.status, "SENT")));
    let refunded = false;
    if (row.depositOrderId) {
      refunded = await this.orders.cancelCommissionOrder(row.depositOrderId);
      if (refunded) await this.event(c.id, "DEPOSIT_REFUNDED");
    }
    await this.event(c.id, "WITHDRAWN");
    const t = tx(maker.locale);
    await this.mail(maker, c, t.withdrawn(c.number), t.withdrawnBody(displayName(buyer), refunded));
    return this.view(buyer, id);
  }

  // --- Lavorazione e saldo ------------------------------------------------------------------------

  /** Tappa pagata (chiamato dagli ordini): avvisa la Maison. */
  private async stagePaid(order: Order) {
    const c = await this.db.query.commissions.findFirst({ where: eq(commissions.id, order.commissionId!) });
    if (!c) return;
    const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, c.maisonId) }))!;
    const maker = (await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) }))!;
    const t = tx(maker.locale);
    const amount = formatEuro(order.totalCents, maker.locale);
    if (order.stage === "DEPOSIT") {
      await this.event(c.id, "DEPOSIT_PAID", { totalCents: order.totalCents });
      await this.mail(maker, c, t.depositPaid(c.number), t.depositPaidBody(amount));
    } else {
      await this.event(c.id, "BALANCE_PAID", { totalCents: order.totalCents });
      await this.mail(maker, c, t.balancePaid(c.number), t.balancePaidBody(amount));
    }
  }

  async startWork(maker: Account, id: string) {
    const { c, maison, buyer } = await this.as(maker, id, "MAKER");
    if (c.status !== "AGREED" || !c.depositOrderId) this.stateError();
    const deposit = await this.orders.commissionOrder(c.depositOrderId);
    if (deposit.status !== "PAID") this.stateError();
    // Lo stato si blocca prima dell'accredito: un ritiro concorrente non può più rimborsare.
    await this.move(c.id, ["AGREED"], "IN_WORK", { workStartedAt: this.now(), makerReadAt: this.now() });
    try {
      await this.orders.releaseCommissionDeposit(deposit.id);
    } catch (err) {
      await this.move(c.id, ["IN_WORK"], "AGREED", { workStartedAt: null });
      throw err;
    }
    await this.event(c.id, "WORK_STARTED");
    const t = tx(buyer.locale);
    await this.mail(buyer, c, t.workStarted(c.number), t.workStartedBody(maison.name));
    return this.view(maker, id);
  }

  async logFitting(maker: Account, id: string, note: unknown) {
    const { c, maison } = await this.as(maker, id, "MAKER");
    if (c.status !== "IN_WORK") this.stateError();
    const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
    if (text.length < 3) throw Errors.validation({ note: "fitting.note_required" });
    const translations = await this.translateInto(text, maker.locale, c.language, maison.discipline);
    await this.db.insert(commissionMessages).values({
      commissionId: c.id,
      author: "MAKER",
      authorAccountId: maker.id,
      kind: "EVENT",
      event: "FITTING",
      body: text,
      language: maker.locale,
      translations,
    });
    await this.db.update(commissions).set({ updatedAt: this.now(), makerReadAt: this.now() }).where(eq(commissions.id, c.id));
    return this.view(maker, id);
  }

  private async agreedProposal(c: Commission) {
    const p = await this.db.query.commissionProposals.findFirst({
      where: and(eq(commissionProposals.commissionId, c.id), eq(commissionProposals.status, "ACCEPTED")),
    });
    if (!p) this.stateError();
    return p;
  }

  async requestBalance(maker: Account, id: string) {
    const { c, maison, buyer } = await this.as(maker, id, "MAKER");
    const p = await this.agreedProposal(c);
    await this.move(c.id, ["IN_WORK"], "BALANCE_DUE", { makerReadAt: this.now() });
    const balance = p.priceCents - p.depositCents;
    await this.event(c.id, "BALANCE_REQUESTED", { totalCents: balance });
    const t = tx(buyer.locale);
    await this.mail(buyer, c, t.balance(c.number), t.balanceBody(maison.name, formatEuro(balance, buyer.locale)));
    return this.view(maker, id);
  }

  async payBalance(buyer: Account, id: string, channel: Channel, ctx: RequestContext) {
    const { c, maison } = await this.as(buyer, id, "BUYER");
    if (c.status !== "BALANCE_DUE") this.stateError();
    if (c.balanceOrderId) return this.reauthorize(buyer, c.balanceOrderId, channel, ctx);
    const p = await this.agreedProposal(c);
    const payment = await this.orders.createCommissionOrder(
      buyer,
      maison,
      { commissionId: c.id, stage: "BALANCE", name: this.stageName("BALANCE", c), grossCents: p.priceCents - p.depositCents, address: c.deliveryAddress! },
      channel,
      ctx,
    );
    const [claimed] = await this.db
      .update(commissions)
      .set({ balanceOrderId: payment.order.id })
      .where(and(eq(commissions.id, c.id), isNull(commissions.balanceOrderId)))
      .returning();
    // Doppio clic: vale il primo ordine di saldo, il secondo si annulla.
    if (!claimed) {
      await this.orders.cancelCommissionOrder(payment.order.id);
      const current = (await this.db.query.commissions.findFirst({ where: eq(commissions.id, c.id) }))!;
      return this.reauthorize(buyer, current.balanceOrderId!, channel, ctx);
    }
    return payment;
  }

  async ship(maker: Account, id: string, input: { carrier?: unknown; trackingCode?: unknown }) {
    const { c } = await this.as(maker, id, "MAKER");
    if (c.status !== "BALANCE_DUE" || !c.balanceOrderId) this.stateError();
    const shipped = await this.orders.shipCommission(maker, c.balanceOrderId, input);
    await this.event(c.id, "SHIPPED", { carrier: shipped.carrier ?? "", trackingCode: shipped.trackingCode ?? "" });
    return this.view(maker, id);
  }

  async confirmDelivery(buyer: Account, id: string) {
    const { c } = await this.as(buyer, id, "BUYER");
    if (c.status !== "BALANCE_DUE" || !c.balanceOrderId) this.stateError();
    await this.orders.confirmDelivery(buyer, c.balanceOrderId, true);
    await this.event(c.id, "DELIVERED");
    return this.view(buyer, id);
  }

  async dispute(buyer: Account, id: string, note: unknown) {
    const { c } = await this.as(buyer, id, "BUYER");
    if (c.status !== "BALANCE_DUE" || !c.balanceOrderId) this.stateError();
    await this.orders.dispute(buyer, c.balanceOrderId, note, true);
    await this.event(c.id, "DISPUTED");
    return this.view(buyer, id);
  }

  // --- Scadenze -----------------------------------------------------------------------------------

  /** Richieste senza risposta oltre le 96 ore: si chiudono e se ne avvisano entrambe le parti. */
  async expireOverdue() {
    const rows = await this.db
      .update(commissions)
      .set({ status: "EXPIRED", updatedAt: this.now() })
      .where(and(eq(commissions.status, "REQUESTED"), isNull(commissions.firstResponseAt), lt(commissions.respondBy, this.now())))
      .returning();
    for (const c of rows) {
      await this.event(c.id, "EXPIRED");
      const maison = (await this.db.query.maisons.findFirst({ where: eq(maisons.id, c.maisonId) }))!;
      const [buyer, maker] = await Promise.all([
        this.db.query.accounts.findFirst({ where: eq(accounts.id, c.buyerAccountId) }),
        this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) }),
      ]);
      if (buyer) await this.mail(buyer, c, tx(buyer.locale).expired(c.number), tx(buyer.locale).expiredBuyer(maison.name, COMMISSION_RESPONSE_HOURS));
      if (maker) await this.mail(maker, c, tx(maker.locale).expired(c.number), tx(maker.locale).expiredMaker(COMMISSION_RESPONSE_HOURS));
    }
    return rows.length;
  }

  // --- Lettura ------------------------------------------------------------------------------------

  async list(account: Account): Promise<{ commissions: CommissionSummary[] }> {
    let rows: Commission[] = [];
    let party: Party = "BUYER";
    if (account.role === "MAKER") {
      party = "MAKER";
      const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) });
      if (maison) rows = await this.db.query.commissions.findMany({ where: eq(commissions.maisonId, maison.id), orderBy: desc(commissions.updatedAt) });
    } else {
      rows = await this.db.query.commissions.findMany({ where: eq(commissions.buyerAccountId, account.id), orderBy: desc(commissions.updatedAt) });
    }
    if (!rows.length) return { commissions: [] };
    const ids = rows.map((r) => r.id);
    const [ms, buyers, orderRows, msgs] = await Promise.all([
      this.db.query.maisons.findMany({ where: inArray(maisons.id, [...new Set(rows.map((r) => r.maisonId))]) }),
      this.db.query.accounts.findMany({ where: inArray(accounts.id, [...new Set(rows.map((r) => r.buyerAccountId))]) }),
      this.db.query.orders.findMany({ where: inArray(orders.commissionId, ids) }),
      this.db.query.commissionMessages.findMany({ where: inArray(commissionMessages.commissionId, ids), columns: { commissionId: true, author: true, createdAt: true } }),
    ]);
    const statusOf = (id: string | null) => (id ? (orderRows.find((o) => o.id === id)?.status ?? null) : null);
    return {
      commissions: rows.map((c) => {
        const readAt = party === "BUYER" ? c.buyerReadAt : c.makerReadAt;
        const buyer = buyers.find((b) => b.id === c.buyerAccountId);
        return {
          id: c.id,
          number: c.number,
          phase: commissionPhase(c.status, statusOf(c.depositOrderId), statusOf(c.balanceOrderId)),
          maison: ms.find((m) => m.id === c.maisonId)?.name ?? "",
          buyer: buyer ? displayName(buyer) : "",
          garment: (c.brief as TailoringBrief).garment,
          respondBy: c.respondBy.toISOString(),
          answered: !!c.firstResponseAt,
          unread: msgs.filter((m) => m.commissionId === c.id && m.author !== party && (!readAt || m.createdAt > readAt)).length,
          updatedAt: c.updatedAt.toISOString(),
        };
      }),
    };
  }

  /** Traduce ciò che manca nella lingua di chi legge (al massimo qualche testo per volta) e lo conserva. */
  private async fillTranslations(c: Commission, maison: Maison, lang: string, msgs: CommissionMessage[], proposals: { id: string; description: string; language: string; translations: Record<string, string> }[]) {
    if (!this.translator.enabled) return;
    const jobs: (() => Promise<void>)[] = [];
    const brief = c.brief as TailoringBrief;
    if (c.language !== lang && !c.briefTranslations[lang]) {
      jobs.push(async () => {
        const out = await this.translator.translate(brief.description, lang, { discipline: maison.discipline });
        if (out) {
          c.briefTranslations = { ...c.briefTranslations, [lang]: out };
          await this.db.update(commissions).set({ briefTranslations: sql`${commissions.briefTranslations} || ${JSON.stringify({ [lang]: out })}::jsonb` }).where(eq(commissions.id, c.id));
        }
      });
    }
    for (const m of msgs) {
      if (!m.body || !m.language || m.language === lang || m.translations[lang]) continue;
      jobs.push(async () => {
        const out = await this.translator.translate(m.body!, lang, { discipline: maison.discipline });
        if (out) {
          m.translations = { ...m.translations, [lang]: out };
          await this.db.update(commissionMessages).set({ translations: sql`${commissionMessages.translations} || ${JSON.stringify({ [lang]: out })}::jsonb` }).where(eq(commissionMessages.id, m.id));
        }
      });
    }
    for (const p of proposals) {
      if (p.language === lang || p.translations[lang]) continue;
      jobs.push(async () => {
        const out = await this.translator.translate(p.description, lang, { discipline: maison.discipline });
        if (out) {
          p.translations = { ...p.translations, [lang]: out };
          await this.db.update(commissionProposals).set({ translations: sql`${commissionProposals.translations} || ${JSON.stringify({ [lang]: out })}::jsonb` }).where(eq(commissionProposals.id, p.id));
        }
      });
    }
    await Promise.all(jobs.slice(0, 12).map((j) => j()));
  }

  async view(account: Account, id: string): Promise<CommissionView> {
    const { c, maison, party, buyer, maker } = await this.load(account, id);
    const lang = this.langOf(party, c, maker);
    const [msgs, proposals, orderRows] = await Promise.all([
      this.db.query.commissionMessages.findMany({ where: eq(commissionMessages.commissionId, c.id), orderBy: asc(commissionMessages.createdAt) }),
      this.db.query.commissionProposals.findMany({ where: eq(commissionProposals.commissionId, c.id), orderBy: asc(commissionProposals.version) }),
      this.db.query.orders.findMany({ where: eq(orders.commissionId, c.id) }),
    ]);
    await this.fillTranslations(c, maison, lang, msgs, proposals);
    await this.db
      .update(commissions)
      .set(party === "BUYER" ? { buyerReadAt: this.now() } : { makerReadAt: this.now() })
      .where(eq(commissions.id, c.id));

    const deposit = orderRows.find((o) => o.id === c.depositOrderId) ?? null;
    const balance = orderRows.find((o) => o.id === c.balanceOrderId) ?? null;
    const phase = commissionPhase(c.status, deposit?.status ?? null, balance?.status ?? null);
    const shown = (body: string, from: string | null, translations: Record<string, string>) => {
      if (!from || from === lang) return { text: body, original: null, translated: false, untranslated: false };
      const tr = translations[lang];
      return tr
        ? { text: tr, original: body, translated: true, untranslated: false }
        : { text: body, original: null, translated: false, untranslated: true };
    };

    const messages: CommissionMessageView[] = msgs.map((m) => {
      const s = m.body ? shown(m.body, m.language, m.translations) : { text: null, original: null, translated: false, untranslated: false };
      return {
        id: m.id,
        author: m.author as CommissionMessageView["author"],
        mine: m.author === party,
        kind: m.kind as CommissionMessageView["kind"],
        ...s,
        originalLanguage: m.language,
        dictated: m.dictated,
        image: m.attachment ? `/v1/commissions/${c.id}/files/${m.attachment}` : null,
        event: (m.event as CommissionEvent | null) ?? null,
        eventData: m.eventData ?? null,
        createdAt: m.createdAt.toISOString(),
      };
    });

    const proposalViews: ProposalView[] = proposals.map((p) => {
      const s = shown(p.description, p.language, p.translations);
      const { balanceCents } = splitDeposit(p.priceCents, p.depositPct);
      return {
        id: p.id,
        version: p.version,
        status: p.status as ProposalView["status"],
        description: s.text,
        original: s.original,
        priceCents: p.priceCents,
        depositPct: p.depositPct,
        depositCents: p.depositCents,
        balanceCents,
        leadTimeWeeks: p.leadTimeWeeks,
        fittings: p.fittings,
        createdAt: p.createdAt.toISOString(),
      };
    });

    const actions: CommissionAction[] = [];
    const closed = c.status === "DECLINED" || c.status === "EXPIRED" || c.status === "WITHDRAWN";
    if (!closed) actions.push("MESSAGE");
    if (party === "BUYER") {
      if (phase === "PROPOSED") actions.push("ACCEPT_PROPOSAL", "REQUEST_CHANGES");
      if (phase === "DEPOSIT_DUE") actions.push("PAY_DEPOSIT");
      if (OPEN.includes(c.status) || c.status === "AGREED") actions.push("WITHDRAW");
      if (phase === "BALANCE_DUE") actions.push("PAY_BALANCE");
      if (phase === "SHIPPED") actions.push("CONFIRM_DELIVERY", "DISPUTE");
    } else {
      if (OPEN.includes(c.status)) actions.push("PROPOSE", "DECLINE");
      if (phase === "DEPOSIT_PAID") actions.push("START_WORK");
      if (c.status === "IN_WORK") actions.push("LOG_FITTING", "REQUEST_BALANCE");
      if (phase === "BALANCE_PAID") actions.push("SHIP");
    }

    const brief = c.brief as TailoringBrief;
    const b = shown(brief.description, c.language, c.briefTranslations);
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      phase,
      viewer: party,
      viewerLanguage: lang,
      languages: { buyer: c.language, maker: maker.locale },
      maison: { id: maison.id, slug: maison.slug, name: maison.name, city: maison.city, region: maison.region },
      buyer: { displayName: displayName(buyer), country: brief.country },
      brief: { ...brief, descriptionShown: b.text, descriptionOriginal: b.original },
      measurements: (c.measurements as Measurements | null) ?? null,
      respondBy: c.respondBy.toISOString(),
      firstResponseAt: c.firstResponseAt?.toISOString() ?? null,
      proposals: proposalViews,
      messages,
      deliveryAddress: (c.deliveryAddress as CommissionView["deliveryAddress"]) ?? null,
      deposit: deposit ? { orderId: deposit.id, status: deposit.status, totalCents: deposit.totalCents } : null,
      balance: balance
        ? {
            orderId: balance.id,
            status: balance.status,
            totalCents: balance.totalCents,
            carrier: balance.carrier,
            trackingCode: balance.trackingCode,
            autoReleaseAt: balance.status === "SHIPPED" && balance.shippedAt ? new Date(balance.shippedAt.getTime() + AUTO_RELEASE_DAYS * DAY).toISOString() : null,
          }
        : null,
      ...(party === "MAKER" ? { payout: { commissionBps: maison.commissionBps } } : {}),
      workStartedAt: c.workStartedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      actions,
    };
  }
}
