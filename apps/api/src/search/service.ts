import { and, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  REGIONS,
  normalizeText,
  searchFiltersSchema,
  type SearchResult,
  type Territory,
} from "@maestranze/shared";
import { toPublicMaison } from "../catalog/service";
import type { Db } from "../db/client";
import { maisons, products } from "../db/schema";

const PAGE_SIZE = 24;

const DISCIPLINE_WORDS: Record<string, string> = {
  FOOD: "food gastronomia cibo alimentari",
  BEVERAGE: "beverage vino vini bevande distillati wine spirits",
  TAILORING: "sartoria sartoriale moda abbigliamento tailoring fashion",
  SPORT: "sport sportivo outdoor",
  CRAFTS: "artigianato artistico design crafts",
};

const provinceName = (code: string) =>
  Object.values(REGIONS)
    .flat()
    .find(([c]) => c === code)?.[1] ?? code;

/**
 * Query di ricerca: il testo come lo intende chi lo scrive (italiano e inglese, con stemming), più una
 * variante per prefisso che recupera le forme che lo stemmer non unifica («caseifici» → «caseificio»).
 */
function tsQuery(q: string, anyWord = false) {
  const words = normalizeText(q).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  // In modalità «almeno una parola» le parole si uniscono con OR (sintassi websearch).
  const n = anyWord ? words.join(" or ") : normalizeText(q);
  const prefix = words.map((w) => (w.length >= 7 ? w.slice(0, -2) : w.length >= 5 ? w.slice(0, -1) : w) + ":*").join(anyWord ? " | " : " & ");
  return prefix
    ? sql`(websearch_to_tsquery('italian', ${n}) || websearch_to_tsquery('english', ${n}) || to_tsquery('simple', ${prefix}))`
    : sql`(websearch_to_tsquery('italian', ${n}) || websearch_to_tsquery('english', ${n}))`;
}

const matchQuery = (q: string, anyWord = false) => sql`${maisons.searchVector} @@ ${tsQuery(q, anyWord)}`;

export class SearchService {
  constructor(private db: Db) {}

  /** Ricalcola l'indice di una Maison da profilo, territorio, riconoscimenti e collezione. */
  async reindex(maisonId: string) {
    const m = await this.db.query.maisons.findFirst({ where: eq(maisons.id, maisonId) });
    if (!m) return;
    const list = await this.db.query.products.findMany({ where: and(eq(products.maisonId, maisonId), eq(products.active, true)) });
    const weighted = {
      a: [m.name, m.city, provinceName(m.province), m.region].join(" "),
      b: [m.tagline.it, m.tagline.en, DISCIPLINE_WORDS[m.discipline], m.certifications.join(" "), ...list.map((p) => `${p.name.it} ${p.name.en ?? ""}`)].join(" "),
      c: [m.story.it, m.story.en, m.craft?.it, m.craft?.en, ...list.map((p) => `${p.description.it} ${p.description.en ?? ""}`)].join(" "),
    };
    const n = (s: string) => normalizeText(s ?? "");
    await this.db.execute(sql`
      update maisons set search_vector =
        setweight(to_tsvector('italian', ${n(weighted.a)}) || to_tsvector('english', ${n(weighted.a)}), 'A') ||
        setweight(to_tsvector('italian', ${n(weighted.b)}) || to_tsvector('english', ${n(weighted.b)}), 'B') ||
        setweight(to_tsvector('italian', ${n(weighted.c)}) || to_tsvector('english', ${n(weighted.c)}), 'C')
      where id = ${maisonId}`);
  }

  async reindexAll() {
    const rows = await this.db.select({ id: maisons.id }).from(maisons);
    for (const r of rows) await this.reindex(r.id);
  }

  /**
   * Prima cerca tutte le parole; se non trova nulla, allarga ad almeno una parola (ordinando per
   * pertinenza) e lo segnala con `relaxed`: chi scrive una frase lunga vuole comunque delle proposte.
   */
  async search(input: unknown): Promise<SearchResult> {
    const f = searchFiltersSchema.parse(input ?? {});
    const strict = await this.run(f, false);
    if (strict.total > 0 || !f.q || !/\s/.test(f.q.trim())) return strict;
    return { ...(await this.run(f, true)), relaxed: true };
  }

  private async run(f: ReturnType<typeof searchFiltersSchema.parse>, anyWord: boolean): Promise<SearchResult> {
    const page = f.page ?? 1;
    const base: SQL[] = [eq(maisons.status, "APPROVED")];
    if (f.q) base.push(matchQuery(f.q, anyWord));
    if (f.cert) base.push(sql`${maisons.certifications} @> ${JSON.stringify([f.cert])}::jsonb`);

    // Le faccette contano ignorando il proprio filtro, così si può cambiare regione o disciplina.
    const territory: SQL[] = [];
    if (f.region) territory.push(eq(maisons.region, f.region));
    if (f.province) territory.push(eq(maisons.province, f.province));
    if (f.city) territory.push(sql`lower(${maisons.city}) = lower(${f.city})`);
    const discipline: SQL[] = f.discipline ? [eq(maisons.discipline, f.discipline)] : [];
    const where = and(...base, ...territory, ...discipline);

    const order = f.q
      ? [
          desc(sql`ts_rank(${maisons.searchVector}, ${tsQuery(f.q, anyWord)})`),
          desc(maisons.approvedAt),
        ]
      : [desc(maisons.approvedAt)];
    const rows = await this.db
      .select()
      .from(maisons)
      .where(where)
      .orderBy(...order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [{ total }] = (await this.db.select({ total: count() }).from(maisons).where(where)) as [{ total: number }];

    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await this.db
          .select({ maisonId: products.maisonId, n: count() })
          .from(products)
          .where(and(inArray(products.maisonId, ids), eq(products.active, true)))
          .groupBy(products.maisonId)
      : [];

    const regions = await this.db
      .select({ region: maisons.region, count: count() })
      .from(maisons)
      .where(and(...base, ...discipline))
      .groupBy(maisons.region)
      .orderBy(maisons.region);
    const disciplines = await this.db
      .select({ discipline: maisons.discipline, count: count() })
      .from(maisons)
      .where(and(...base, ...territory))
      .groupBy(maisons.discipline);

    return {
      results: rows.map((m) => ({ ...toPublicMaison(m), productCount: counts.find((c) => c.maisonId === m.id)?.n ?? 0 })),
      total,
      page,
      pageSize: PAGE_SIZE,
      facets: { regions, disciplines },
    };
  }

  /** Albero regione → provincia → comune, solo dove ci sono Maison selezionate. */
  async territories(): Promise<Territory[]> {
    const rows = await this.db
      .select({ region: maisons.region, province: maisons.province, city: maisons.city, count: count() })
      .from(maisons)
      .where(eq(maisons.status, "APPROVED"))
      .groupBy(maisons.region, maisons.province, maisons.city);
    const out: Territory[] = [];
    for (const [region, provinces] of Object.entries(REGIONS)) {
      const inRegion = rows.filter((r) => r.region === region);
      if (!inRegion.length) continue;
      out.push({
        region,
        count: inRegion.reduce((n, r) => n + r.count, 0),
        provinces: provinces
          .map(([code, name]) => {
            const cities = inRegion.filter((r) => r.province === code);
            return { code, name, count: cities.reduce((n, r) => n + r.count, 0), cities: cities.map((c) => ({ city: c.city, count: c.count })) };
          })
          .filter((p) => p.count > 0),
      });
    }
    return out;
  }
}
