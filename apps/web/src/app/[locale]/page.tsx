import Link from "next/link";
import { Monogram } from "@/components/brand";
import { Footer, Header } from "@/components/header";
import { HeroPlate } from "@/components/plate";
import { Reveal } from "@/components/reveal";
import { ArtsSection, TerritoriesSection } from "@/components/sections";
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
                <Link href={`/${locale}/arti`} className="link">
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

        {/* --- Le Arti e i Territori: anteprime delle pagine dedicate --- */}
        <ArtsSection locale={locale} />
        <TerritoriesSection locale={locale} />

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
