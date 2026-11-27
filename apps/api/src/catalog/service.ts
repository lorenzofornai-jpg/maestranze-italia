import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import {
  maisonSchema,
  productSchema,
  regionOf,
  slugify,
  type MaisonStatus,
  type PublicMaison,
  type PublicProduct,
} from "@maestranze/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { accounts, auditEvents, maisons, products, type Account, type Maison, type Product } from "../db/schema";
import { randomToken } from "../lib/crypto";
import { ApiError, Errors } from "../lib/errors";
import { renderEmail, type Notifier } from "../lib/notifications";
import { parseOrThrow } from "../lib/validation";

const T = {
  it: {
    submittedSubject: "Maestranze Italia — nuova candidatura",
    submittedBody: (name: string) => `La Maison «${name}» ha inviato la candidatura alla selezione.`,
    approvedSubject: "La tua Maison è stata selezionata",
    approvedBody: (name: string) =>
      `Benvenuta in Maestranze Italia. «${name}» è ora visibile ai clienti del portale. Da oggi puoi ricevere ordini.`,
    rejectedSubject: "Maestranze Italia — esito della candidatura",
    rejectedBody: (name: string, note: string) =>
      `Grazie per aver presentato «${name}». Per ora la candidatura non è stata accolta. Nota della selezione: ${note}`,
    cta: "Apri l'area riservata",
  },
  en: {
    submittedSubject: "Maestranze Italia — new application",
    submittedBody: (name: string) => `The Maison “${name}” has applied for selection.`,
    approvedSubject: "Your Maison has been selected",
    approvedBody: (name: string) =>
      `Welcome to Maestranze Italia. “${name}” is now visible to the portal's clients. From today you can receive orders.`,
    rejectedSubject: "Maestranze Italia — application outcome",
    rejectedBody: (name: string, note: string) =>
      `Thank you for presenting “${name}”. For now the application has not been accepted. Selection note: ${note}`,
    cta: "Open your private area",
  },
};
const tx = (locale: string) => (locale === "en" ? T.en : T.it);

/** Chi può vedere i prezzi riservati: clienti professionali (domanda, con partita IVA) e lo staff. */
export const seesB2bPrices = (viewer?: Account | null) =>
  !!viewer && (viewer.isAdmin || (viewer.role === "BUYER" && viewer.subjectType === "COMPANY"));

export function toPublicProduct(p: Product, viewer?: Account | null): PublicProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    b2bPriceCents: seesB2bPrices(viewer) ? p.b2bPriceCents : null,
    unit: p.unit,
    minQty: p.minQty,
    available: p.madeToOrder || p.stock == null || p.stock > 0,
    madeToOrder: p.madeToOrder,
    vatRateBps: p.vatRateBps,
    image: p.image,
  };
}

export function toPublicMaison(m: Maison): PublicMaison {
  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    discipline: m.discipline,
    tagline: m.tagline,
    story: m.story,
    craft: m.craft ?? null,
    foundedYear: m.foundedYear,
    region: m.region,
    province: m.province,
    city: m.city,
    certifications: m.certifications,
    b2bMinOrderCents: m.b2bMinOrderCents,
    leadTimeDays: m.leadTimeDays,
    coverImage: m.coverImage,
    acceptsCommissions: m.acceptsCommissions && m.discipline === "TAILORING",
  };
}

export class CatalogService {
  constructor(
    private db: Db,
    private config: Config,
    private notifier: Notifier,
    private now: () => Date = () => new Date(),
    /** Avvisato a ogni modifica di testi o collezione (per l'indice di ricerca). */
    private onChange: (maisonId: string) => Promise<void> = async () => {},
  ) {}

  private async audit(accountId: string, type: string, meta?: Record<string, unknown>) {
    await this.db.insert(auditEvents).values({ accountId, type, meta });
  }

  private requireMaker(account: Account) {
    if (account.role !== "MAKER") throw Errors.forbidden();
  }

  private async uniqueSlug(base: string, table: "maison" | { maisonId: string }, excludeId?: string): Promise<string> {
    const root = slugify(base) || "maison";
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      const clash =
        table === "maison"
          ? await this.db.query.maisons.findFirst({ where: eq(maisons.slug, candidate) })
          : await this.db.query.products.findFirst({ where: and(eq(products.maisonId, table.maisonId), eq(products.slug, candidate)) });
      if (!clash || clash.id === excludeId) return candidate;
    }
    return `${root}-${randomToken(4).toLowerCase()}`;
  }

  // --- La mia Maison --------------------------------------------------------------------------

  async myMaison(account: Account) {
    this.requireMaker(account);
    const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) });
    if (!maison) return { maison: null, products: [] };
    const list = await this.db.query.products.findMany({
      where: eq(products.maisonId, maison.id),
      orderBy: [asc(products.position), asc(products.createdAt)],
    });
    return { maison: { ...toPublicMaison(maison), status: maison.status, reviewNote: maison.reviewNote, commissionBps: maison.commissionBps }, products: list.map((p) => ({ ...toPublicProduct(p, account), b2bPriceCents: p.b2bPriceCents, stock: p.stock, active: p.active })) };
  }

  private async ownMaison(account: Account): Promise<Maison> {
    this.requireMaker(account);
    const maison = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) });
    if (!maison) throw Errors.notFound();
    return maison;
  }

  async saveMaison(account: Account, input: unknown) {
    this.requireMaker(account);
    const data = parseOrThrow(maisonSchema, input);
    const existing = await this.db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) });
    const values = {
      name: data.name,
      discipline: data.discipline,
      tagline: data.tagline,
      story: data.story,
      craft: data.craft ?? null,
      foundedYear: data.foundedYear ?? null,
      province: data.province,
      region: regionOf(data.province)!,
      city: data.city,
      certifications: data.certifications,
      b2bMinOrderCents: data.b2bMinOrderCents ?? null,
      leadTimeDays: data.leadTimeDays ?? null,
      acceptsCommissions: data.discipline === "TAILORING" && (data.acceptsCommissions ?? existing?.acceptsCommissions ?? false),
      updatedAt: this.now(),
    };
    if (existing) {
      if (existing.status === "SUSPENDED") throw Errors.forbidden();
      const slug = existing.status === "APPROVED" ? existing.slug : await this.uniqueSlug(data.name, "maison", existing.id);
      await this.db.update(maisons).set({ ...values, slug }).where(eq(maisons.id, existing.id));
      await this.onChange(existing.id);
    } else {
      const [row] = await this.db
        .insert(maisons)
        .values({ ...values, accountId: account.id, slug: await this.uniqueSlug(data.name, "maison") })
        .returning();
      await this.onChange(row!.id);
    }
    return this.myMaison(account);
  }

  async setCover(account: Account, url: string) {
    const maison = await this.ownMaison(account);
    await this.db.update(maisons).set({ coverImage: url, updatedAt: this.now() }).where(eq(maisons.id, maison.id));
    return { coverImage: url };
  }

  async saveProduct(account: Account, input: unknown, productId?: string) {
    const maison = await this.ownMaison(account);
    const data = parseOrThrow(productSchema, input);
    const values = {
      name: data.name,
      description: data.description,
      priceCents: data.priceCents,
      b2bPriceCents: data.b2bPriceCents ?? null,
      unit: data.unit,
      minQty: data.minQty,
      stock: data.madeToOrder ? null : (data.stock ?? null),
      madeToOrder: data.madeToOrder,
      active: data.active,
      vatRateBps: data.vatRateBps,
      updatedAt: this.now(),
    };
    if (productId) {
      const [row] = await this.db
        .update(products)
        .set(values)
        .where(and(eq(products.id, productId), eq(products.maisonId, maison.id)))
        .returning();
      if (!row) throw Errors.notFound();
      await this.onChange(maison.id);
      return { id: row.id };
    }
    const [{ n }] = (await this.db.select({ n: count() }).from(products).where(eq(products.maisonId, maison.id))) as [{ n: number }];
    if (n >= 200) throw new ApiError(400, "CATALOG_LIMIT");
    const [row] = await this.db
      .insert(products)
      .values({ ...values, maisonId: maison.id, slug: await this.uniqueSlug(data.name.it, { maisonId: maison.id }), position: n })
      .returning();
    await this.onChange(maison.id);
    return { id: row!.id };
  }

  async setProductImage(account: Account, productId: string, url: string) {
    const maison = await this.ownMaison(account);
    const [row] = await this.db
      .update(products)
      .set({ image: url, updatedAt: this.now() })
      .where(and(eq(products.id, productId), eq(products.maisonId, maison.id)))
      .returning();
    if (!row) throw Errors.notFound();
    return { image: url };
  }

  async deleteProduct(account: Account, productId: string) {
    const maison = await this.ownMaison(account);
    const [row] = await this.db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.maisonId, maison.id)))
      .returning();
    if (!row) throw Errors.notFound();
    await this.onChange(maison.id);
  }

  /** Candidatura alla selezione: serve un profilo completo e almeno un prodotto attivo. */
  async submit(account: Account) {
    const maison = await this.ownMaison(account);
    if (maison.status !== "DRAFT" && maison.status !== "REJECTED") throw new ApiError(409, "ALREADY_SUBMITTED");
    const missing: Record<string, string> = {};
    const active = await this.db.query.products.findMany({ where: and(eq(products.maisonId, maison.id), eq(products.active, true)) });
    if (active.length === 0) missing.products = "maison.needs_product";
    if (!maison.coverImage) missing.coverImage = "maison.needs_cover";
    if (Object.keys(missing).length) throw Errors.validation(missing);

    await this.db
      .update(maisons)
      .set({ status: "SUBMITTED", submittedAt: this.now(), reviewNote: null, updatedAt: this.now() })
      .where(eq(maisons.id, maison.id));
    await this.audit(account.id, "maison.submitted", { maisonId: maison.id });

    const admins = await this.db.query.accounts.findMany({ where: eq(accounts.isAdmin, true) });
    for (const admin of admins) {
      const t = tx(admin.locale);
      await this.notifier.email({
        to: admin.email,
        subject: t.submittedSubject,
        ...renderEmail({
          locale: admin.locale,
          title: t.submittedSubject,
          body: t.submittedBody(maison.name),
          cta: { label: t.cta, url: `${this.config.WEB_ORIGIN}/${admin.locale}/area/selezione` },
        }),
      });
    }
    return { status: "SUBMITTED" as MaisonStatus };
  }

  // --- Selezione (staff) -------------------------------------------------------------------------

  async reviewQueue(status: MaisonStatus = "SUBMITTED") {
    const rows = await this.db
      .select({ maison: maisons, email: accounts.email, vatNumber: accounts.vatNumber, companyName: accounts.companyName })
      .from(maisons)
      .innerJoin(accounts, eq(accounts.id, maisons.accountId))
      .where(eq(maisons.status, status))
      .orderBy(desc(maisons.submittedAt));
    const ids = rows.map((r) => r.maison.id);
    const prods = ids.length ? await this.db.query.products.findMany({ where: inArray(products.maisonId, ids) }) : [];
    return rows.map((r) => ({
      ...toPublicMaison(r.maison),
      status: r.maison.status,
      submittedAt: r.maison.submittedAt,
      commissionBps: r.maison.commissionBps,
      applicant: { email: r.email, vatNumber: r.vatNumber, companyName: r.companyName },
      products: prods.filter((p) => p.maisonId === r.maison.id).map((p) => ({ ...toPublicProduct(p), b2bPriceCents: p.b2bPriceCents })),
    }));
  }

  async decide(admin: Account, maisonId: string, input: { decision?: unknown; note?: unknown; commissionBps?: unknown }) {
    if (!admin.isAdmin) throw Errors.forbidden();
    const decision = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : null;
    if (!decision) throw Errors.validation({ decision: "decision.invalid" });
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
    if (decision === "REJECTED" && note.length < 10) throw Errors.validation({ note: "review.note_required" });
    const commission = input.commissionBps == null ? undefined : Number(input.commissionBps);
    if (commission !== undefined && (!Number.isInteger(commission) || commission < 0 || commission > 3000)) {
      throw Errors.validation({ commissionBps: "commission.invalid" });
    }

    const [maison] = await this.db
      .update(maisons)
      .set({
        status: decision,
        reviewNote: note || null,
        approvedAt: decision === "APPROVED" ? this.now() : null,
        ...(commission !== undefined ? { commissionBps: commission } : {}),
        updatedAt: this.now(),
      })
      .where(and(eq(maisons.id, maisonId), eq(maisons.status, "SUBMITTED")))
      .returning();
    if (!maison) throw Errors.notFound();
    await this.audit(admin.id, `maison.${decision.toLowerCase()}`, { maisonId });

    const owner = await this.db.query.accounts.findFirst({ where: eq(accounts.id, maison.accountId) });
    if (owner) {
      const t = tx(owner.locale);
      const subject = decision === "APPROVED" ? t.approvedSubject : t.rejectedSubject;
      await this.notifier.email({
        to: owner.email,
        subject,
        ...renderEmail({
          locale: owner.locale,
          title: subject,
          body: decision === "APPROVED" ? t.approvedBody(maison.name) : t.rejectedBody(maison.name, note),
          cta: { label: t.cta, url: `${this.config.WEB_ORIGIN}/${owner.locale}/area/maison` },
        }),
      });
    }
    return { status: maison.status };
  }

  // --- Pubblico -------------------------------------------------------------------------------

  async publicMaison(slug: string, viewer?: Account | null): Promise<PublicMaison> {
    const maison = await this.db.query.maisons.findFirst({ where: and(eq(maisons.slug, slug), eq(maisons.status, "APPROVED")) });
    if (!maison) throw Errors.notFound();
    const list = await this.db.query.products.findMany({
      where: and(eq(products.maisonId, maison.id), eq(products.active, true)),
      orderBy: [asc(products.position), asc(products.createdAt)],
    });
    return { ...toPublicMaison(maison), products: list.map((p) => toPublicProduct(p, viewer)) };
  }
}
