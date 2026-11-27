import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatEuro, pick, type PublicMaison } from "@maestranze/shared";
import { Footer, Header } from "@/components/header";
import { Reveal } from "@/components/reveal";
import { AddToOrder } from "@/components/add-to-order";
import { isLocale, translate } from "@/lib/i18n";
import { mediaUrl, serverApi } from "@/lib/server-api";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const m = await serverApi<PublicMaison>(`/maisons/${encodeURIComponent(slug)}`);
  if (!m) return {};
  return { title: m.name, description: pick(m.tagline, locale) };
}

const SWATCH: Record<string, string> = {
  FOOD: "food",
  BEVERAGE: "beverage",
  TAILORING: "tailoring",
  SPORT: "sport",
  CRAFTS: "crafts",
};

export default async function MaisonPage({ params }: { params: Params }) {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const t = (k: string, v?: Record<string, string | number>) => translate(locale, k, v);
  const m = await serverApi<PublicMaison>(`/maisons/${encodeURIComponent(slug)}`);
  if (!m) notFound();

  const cover = mediaUrl(m.coverImage);
  const products = m.products ?? [];
  const craft = pick(m.craft, locale);

  return (
    <>
      <Header overlay dark />
      <main className="maison">
        {/* Apertura: copertina a tutta altezza, nome in serif, motto in corsivo */}
        <section className="maison-hero">
          <div className={`maison-cover swatch-${SWATCH[m.discipline]}`}>
            {cover && <img src={cover} alt="" />}
            <div className="maison-veil" />
          </div>
          <div className="wrap maison-hero-copy">
            <span className="eyebrow rise" style={{ animationDelay: "200ms" }}>
              {t(`discipline.${m.discipline}`)} · {m.city}, {m.region}
            </span>
            <h1 className="display h1 rise" style={{ animationDelay: "350ms" }}>
              {m.name}
            </h1>
            <p className="maison-tagline italic rise" style={{ animationDelay: "550ms" }}>
              {pick(m.tagline, locale)}
            </p>
            {m.foundedYear && (
              <span className="maison-since rise" style={{ animationDelay: "700ms" }}>
                {t("maison.since", { year: m.foundedYear })}
              </span>
            )}
          </div>
        </section>

        {/* La storia */}
        <section className="maison-story">
          <div className="wrap maison-story-grid">
            <Reveal>
              <span className="eyebrow">{t("maison.story")}</span>
            </Reveal>
            <Reveal delay={120} className="maison-story-text">
              {pick(m.story, locale)
                .split(/\n{2,}/)
                .map((p, i) => (
                  <p key={i} className={i === 0 ? "dropcap" : undefined}>
                    {p}
                  </p>
                ))}
            </Reveal>
            <Reveal delay={240} className="maison-facts">
              {m.certifications.length > 0 && (
                <ul className="certs">
                  {m.certifications.map((c) => (
                    <li key={c}>{t(`cert.${c}`)}</li>
                  ))}
                </ul>
              )}
              {(m.b2bMinOrderCents || m.leadTimeDays) && (
                <div className="facts">
                  <span className="eyebrow plain">{t("maison.conditions")}</span>
                  {m.b2bMinOrderCents ? <span>{t("maison.min_order", { amount: formatEuro(m.b2bMinOrderCents, locale) })}</span> : null}
                  {m.leadTimeDays ? <span>{t("maison.lead_time", { days: m.leadTimeDays })}</span> : null}
                </div>
              )}
            </Reveal>
          </div>
        </section>

        {craft && (
          <section className="maison-craft">
            <div className="wrap">
              <Reveal className="maison-craft-inner">
                <span className="eyebrow">{t("maison.craft")}</span>
                <p className="display h3 italic">{craft}</p>
              </Reveal>
            </div>
          </section>
        )}

        {m.acceptsCommissions && (
          <section className="maison-bespoke">
            <div className="wrap">
              <Reveal className="maison-bespoke-inner">
                <span className="eyebrow">{t("bespoke.eyebrow")}</span>
                <h2 className="display h2">{t("bespoke.title")}</h2>
                <p className="lead">{t("bespoke.body")}</p>
                <Link href={`/${locale}/maison/${m.slug}/su-misura`} className="btn">
                  {t("bespoke.cta")} <span className="arrow" />
                </Link>
              </Reveal>
            </div>
          </section>
        )}

        {/* La collezione */}
        <section className="maison-collection">
          <div className="wrap">
            <Reveal className="section-head">
              <span className="eyebrow">{t("maison.collection")}</span>
            </Reveal>
            {products.length === 0 && <p className="italic lead">{t("maison.empty")}</p>}
            <div className="products-grid">
              {products.map((p, i) => {
                const img = mediaUrl(p.image);
                return (
                  <Reveal key={p.id} delay={(i % 3) * 120} as="article" className="product">
                    <div className={`product-image swatch-${SWATCH[m.discipline]}`}>
                      {img && <img src={img} alt={pick(p.name, locale)} loading="lazy" />}
                      {p.madeToOrder && <span className="product-flag">{t("maison.made_to_order")}</span>}
                    </div>
                    <h3 className="display">{pick(p.name, locale)}</h3>
                    <p className="product-desc">{pick(p.description, locale)}</p>
                    <div className="product-price">
                      {p.b2bPriceCents != null ? (
                        <>
                          <span className="price">{formatEuro(p.b2bPriceCents, locale)}</span>
                          <span className="small">
                            {t("maison.b2b_price")} · {t("maison.vat_excluded")} · {t(`unit.${p.unit}`)}
                          </span>
                          <span className="small strike">{formatEuro(p.priceCents, locale)}</span>
                        </>
                      ) : (
                        <>
                          <span className="price">{formatEuro(p.priceCents, locale)}</span>
                          <span className="small">
                            {t("maison.vat_included")} · {t(`unit.${p.unit}`)}
                          </span>
                        </>
                      )}
                      {p.minQty > 1 && <span className="small">{t("maison.min_qty", { n: p.minQty })}</span>}
                    </div>
                    {p.available ? (
                      <AddToOrder maison={{ id: m.id, slug: m.slug, name: m.name }} product={p} />
                    ) : (
                      <span className="small italic">{t("maison.unavailable")}</span>
                    )}
                  </Reveal>
                );
              })}
            </div>
            <div style={{ marginTop: 80 }}>
              <Link href={`/${locale}/maison`} className="link">
                {t("maison.back")}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
