import type { Metadata } from "next";
import Link from "next/link";
import { DISCIPLINES, REGIONS, pick, type SearchResult, type Territory } from "@maestranze/shared";
import { Footer, Header } from "@/components/header";
import { Reveal } from "@/components/reveal";
import { SearchBar } from "@/components/search-bar";
import { Crumbs } from "@/components/sections";
import { isLocale, translate } from "@/lib/i18n";
import { mediaUrl, serverApi } from "@/lib/server-api";

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: translate(isLocale(locale) ? locale : "it", "explore.eyebrow") };
}

const FILTERS = ["q", "discipline", "region", "province", "city", "cert", "page"] as const;
const SWATCH: Record<string, string> = { FOOD: "food", BEVERAGE: "beverage", TAILORING: "tailoring", SPORT: "sport", CRAFTS: "crafts" };

export default async function Explore({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SP }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const t = (k: string, v?: Record<string, string | number>) => translate(locale, k, v);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

  const current = new URLSearchParams();
  for (const k of FILTERS) {
    const v = one(k);
    if (v) current.set(k, v);
  }
  /** Link che cambia un filtro e mantiene gli altri (la frase interpretata si perde: si è passati ai filtri). */
  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(current);
    next.delete("page");
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    return `/${locale}/esplora${s ? `?${s}` : ""}`;
  };

  const [data, tree] = await Promise.all([
    serverApi<SearchResult>(`/maisons?${current.toString()}`),
    serverApi<{ territories: Territory[] }>("/territories"),
  ]);
  const results = data?.results ?? [];
  const total = data?.total ?? 0;
  const region = one("region");
  const province = one("province");
  const discipline = one("discipline");
  const provinceName = province ? Object.values(REGIONS).flat().find(([c]) => c === province)?.[1] : undefined;
  const understood = one("letto");
  const hasFilters = FILTERS.some((k) => k !== "page" && one(k));
  const pages = data ? Math.ceil(total / data.pageSize) : 1;
  const page = data?.page ?? 1;

  return (
    <>
      <Header />
      <main className="explore">
        <section className="explore-head">
          <div className="wrap">
            <Crumbs locale={locale} label={t("nav.maisons")} />
            <span className="eyebrow rise">{t("explore.eyebrow")}</span>
            <h1 className="display h2 rise" style={{ animationDelay: "150ms" }}>
              {t("explore.title")}
            </h1>
            <div className="rise" style={{ animationDelay: "300ms" }}>
              <SearchBar initial={one("frase") ?? ""} />
            </div>
            {understood && (
              <p className="understood rise" style={{ animationDelay: "400ms" }}>
                <span className="italic">{t("explore.understood", { text: understood })}</span>
                {one("llm") && <span className="badge">{t("explore.understood.llm")}</span>}
                {one("pro") && <span className="small">{t("explore.professional")}</span>}
              </p>
            )}
          </div>
        </section>

        <div className="wrap explore-grid">
          <aside className="explore-aside">
            <nav className="facet">
              <span className="eyebrow plain">{t("nav.arts")}</span>
              <Link href={href({ discipline: undefined })} aria-current={!discipline ? "true" : undefined}>
                {t("explore.all_disciplines")}
              </Link>
              {DISCIPLINES.map((d) => {
                const n = data?.facets.disciplines.find((x) => x.discipline === d)?.count ?? 0;
                return (
                  <Link key={d} href={href({ discipline: d })} aria-current={discipline === d ? "true" : undefined} className={n ? "" : "empty"}>
                    {t(`discipline.${d}`)} <span>{n}</span>
                  </Link>
                );
              })}
            </nav>
            <nav className="facet">
              <span className="eyebrow plain">{t("explore.territories")}</span>
              <Link href={href({ region: undefined, province: undefined, city: undefined })} aria-current={!region && !province ? "true" : undefined}>
                {t("explore.all_regions")}
              </Link>
              {(tree?.territories ?? []).map((r) => (
                <div key={r.region} className="facet-group">
                  <Link href={href({ region: r.region, province: undefined, city: undefined })} aria-current={region === r.region && !province ? "true" : undefined}>
                    {r.region} <span>{r.count}</span>
                  </Link>
                  {region === r.region &&
                    r.provinces.map((p) => (
                      <Link
                        key={p.code}
                        className="sub"
                        href={href({ region: r.region, province: p.code, city: undefined })}
                        aria-current={province === p.code ? "true" : undefined}
                      >
                        {p.name} <span>{p.count}</span>
                      </Link>
                    ))}
                </div>
              ))}
            </nav>
          </aside>

          <section className="explore-results">
            <div className="results-head">
              <span className="results-count">
                {total === 1 ? t("explore.results.one") : t("explore.results", { n: total })}
                {(provinceName || region) && <span className="italic"> · {provinceName ?? region}</span>}
                {one("q") && <span className="italic"> · «{one("q")}»</span>}
              </span>
              {hasFilters && (
                <Link href={`/${locale}/esplora`} className="link">
                  {t("explore.clear")}
                </Link>
              )}
            </div>
            {data?.relaxed && <p className="notice">{t("explore.relaxed")}</p>}
            {results.length === 0 && <p className="lead italic">{t("explore.none")}</p>}
            <div className="maison-cards">
              {results.map((m, i) => (
                <Reveal key={m.id} delay={(i % 2) * 120} as="article" className="maison-card">
                  <Link href={`/${locale}/maison/${m.slug}`}>
                    <div className={`card-cover swatch-${SWATCH[m.discipline]}`}>
                      {m.coverImage && <img src={mediaUrl(m.coverImage)!} alt="" loading="lazy" />}
                    </div>
                    <span className="eyebrow plain">
                      {t(`discipline.${m.discipline}`)} · {m.city}, {m.province}
                    </span>
                    <h2 className="display">{m.name}</h2>
                    <p className="italic">{pick(m.tagline, locale)}</p>
                    <span className="small">{t("explore.products", { n: m.productCount })}</span>
                  </Link>
                </Reveal>
              ))}
            </div>
            {pages > 1 && (
              <div className="pager">
                {page > 1 && (
                  <Link className="link" href={href({ page: String(page - 1) })}>
                    {t("explore.prev")}
                  </Link>
                )}
                <span className="small">
                  {page} / {pages}
                </span>
                {page < pages && (
                  <Link className="link" href={href({ page: String(page + 1) })}>
                    {t("explore.next")}
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
