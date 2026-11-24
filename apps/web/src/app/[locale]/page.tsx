import Link from "next/link";
import { REGIONS } from "@maestranze/shared";
import { Monogram } from "@/components/brand";
import { Footer, Header } from "@/components/header";
import { ARTS, HeroPlate } from "@/components/plate";
import { Reveal } from "@/components/reveal";
import { SearchBar } from "@/components/search-bar";
import { isLocale, translate, type MessageKey } from "@/lib/i18n";

const ROMAN = ["I", "II", "III", "IV", "V"];

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const t = (k: MessageKey) => translate(locale, k);

  return (
    <>
      <Header overlay />
      <main>
        {/* --- Apertura ------------------------------------------------------------------- */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="eyebrow rise" style={{ animationDelay: "200ms" }}>
                {t("hero.eyebrow")}
              </span>
              <h1 className="display h1 hero-title">
                <span className="rise" style={{ animationDelay: "350ms" }}>
                  {t("hero.title.1")}
                </span>
                <span className="rise" style={{ animationDelay: "500ms" }}>
                  <em>{t("hero.title.2")}</em>
                </span>
                <span className="rise" style={{ animationDelay: "650ms" }}>
                  {t("hero.title.3")}
                </span>
              </h1>
              <p className="lead rise" style={{ animationDelay: "850ms" }}>
                {t("hero.body")}
              </p>
              <div className="hero-cta rise" style={{ animationDelay: "1000ms" }}>
                <Link href={`/${locale}/registrati`} className="btn">
                  {t("hero.cta.request")} <span className="arrow" />
                </Link>
                <Link href={`/${locale}#arti`} className="link">
                  {t("hero.cta.discover")}
                </Link>
              </div>
            </div>
            <figure className="hero-plate fade" style={{ animationDelay: "300ms" }}>
              <HeroPlate />
              <figcaption>
                <span>Tav. I</span>
                <span className="italic">{t("hero.caption")}</span>
              </figcaption>
            </figure>
          </div>
          <div className="hero-scroll" aria-hidden="true">
            <span />
          </div>
        </section>

        {/* --- Due mondi ------------------------------------------------------------------ */}
        <section className="worlds">
          <div className="wrap">
            <Reveal className="section-head center">
              <span className="eyebrow">{t("worlds.eyebrow")}</span>
              <h2 className="display h2">{t("worlds.title")}</h2>
            </Reveal>
            <div className="worlds-grid">
              {(["buyer", "maker"] as const).map((side, i) => (
                <Reveal key={side} delay={i * 150} as="article" className={`world world-${side}`}>
                  <span className="world-num">{ROMAN[i]}</span>
                  <span className="eyebrow plain">{t(`worlds.${side}.label`)}</span>
                  <h3 className="display h3">{t(`worlds.${side}.title`)}</h3>
                  <p>{t(`worlds.${side}.body`)}</p>
                  <p className="world-list italic">{t(`worlds.${side}.list`)}</p>
                  <Link href={`/${locale}/registrati?ruolo=${side === "buyer" ? "domanda" : "offerta"}`} className="link">
                    {t("worlds.cta")}
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* --- Le Arti -------------------------------------------------------------------- */}
        <section className="arts" id="arti">
          <div className="wrap">
            <Reveal className="section-head">
              <span className="eyebrow">{t("arts.eyebrow")}</span>
              <h2 className="display h2">{t("arts.title")}</h2>
            </Reveal>
            <div className="arts-grid">
              {ARTS.map((art, i) => (
                <Reveal key={art} delay={i * 110} as="article" className="art">
                  <Link href={`/${locale}/esplora?discipline=${art.toUpperCase()}`}>
                    <div className={`swatch swatch-${art}`}>
                      <span className="swatch-num">{ROMAN[i]}</span>
                    </div>
                    <h3 className="display">{t(`arts.${art}`)}</h3>
                    <p className="italic">{t(`arts.${art}.material`)}</p>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* --- Territori ------------------------------------------------------------------ */}
        <section className="territories" id="territori">
          <div className="wrap territories-grid">
            <Reveal className="territories-intro">
              <span className="eyebrow">{t("territories.eyebrow")}</span>
              <h2 className="display h2">{t("territories.title")}</h2>
              <p className="lead">{t("territories.body")}</p>
              <div style={{ marginTop: 12 }}>
                <SearchBar />
              </div>
            </Reveal>
            <Reveal delay={150} className="regions">
              <ol>
                {Object.entries(REGIONS).map(([region, provinces], i) => (
                  <li key={region}>
                    <Link href={`/${locale}/esplora?region=${encodeURIComponent(region)}`}>
                      <span className="region-n">{String(i + 1).padStart(2, "0")}</span>
                      <span className="region-name">{region}</span>
                      <span className="region-p">{provinces.map(([c]) => c).join(" · ")}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* --- Il patto ------------------------------------------------------------------- */}
        <section className="pact" id="patto">
          <div className="wrap">
            <Reveal className="section-head center">
              <Monogram size={44} color="#a68a5b" />
              <span className="eyebrow">{t("pact.eyebrow")}</span>
              <h2 className="display h2">{t("pact.title")}</h2>
            </Reveal>
            <div className="pact-grid">
              {([1, 2, 3] as const).map((n, i) => (
                <Reveal key={n} delay={i * 140} as="article" className="pact-item">
                  <span className="pact-n">{ROMAN[i]}</span>
                  <h3 className="display h3">{t(`pact.${n}.title`)}</h3>
                  <p>{t(`pact.${n}.body`)}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="pact-cta">
              <Link href={`/${locale}/registrati`} className="btn light">
                {t("hero.cta.request")} <span className="arrow" />
              </Link>
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
