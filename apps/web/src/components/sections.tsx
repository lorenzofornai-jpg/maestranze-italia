import Link from "next/link";
import { REGIONS } from "@maestranze/shared";
import { translate, type Locale } from "@/lib/i18n";
import { ARTS } from "./plate";
import { Reveal } from "./reveal";
import { SearchBar } from "./search-bar";

const ROMAN = ["I", "II", "III", "IV", "V"];

/** Conteggio «n Maison» nella lingua attiva. */
const countLabel = (locale: Locale, n: number) => translate(locale, n === 1 ? "count.maisons.one" : "count.maisons", { n });

/** Le cinque Arti, ciascuna con il suo campione di materia. Sulla home è un'anteprima, su /arti la pagina. */
export function ArtsSection({ locale, counts, heading = "h2" }: { locale: Locale; counts?: Record<string, number>; heading?: "h1" | "h2" }) {
  const t = (k: string) => translate(locale, k);
  const H = heading;
  return (
    <section className="arts" id="arti">
      <div className="wrap">
        <Reveal className="section-head">
          <span className="eyebrow">{t("arts.eyebrow")}</span>
          <H className="display h2">{t("arts.title")}</H>
        </Reveal>
        <div className="arts-grid">
          {ARTS.map((art, i) => {
            const n = counts?.[art.toUpperCase()];
            return (
              <Reveal key={art} delay={i * 110} as="article" className="art">
                <Link href={`/${locale}/esplora?discipline=${art.toUpperCase()}`}>
                  <div className={`swatch swatch-${art}`}>
                    <span className="swatch-num">{ROMAN[i]}</span>
                  </div>
                  <h3 className="display">{t(`arts.${art}`)}</h3>
                  <p className="italic">{t(`arts.${art}.material`)}</p>
                  {n !== undefined && <span className="small art-count">{countLabel(locale, n)}</span>}
                </Link>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Le venti regioni, con la ricerca in linguaggio naturale. */
export function TerritoriesSection({ locale, counts, heading = "h2" }: { locale: Locale; counts?: Record<string, number>; heading?: "h1" | "h2" }) {
  const t = (k: string) => translate(locale, k);
  const H = heading;
  return (
    <section className="territories" id="territori">
      <div className="wrap territories-grid">
        <Reveal className="territories-intro">
          <span className="eyebrow">{t("territories.eyebrow")}</span>
          <H className="display h2">{t("territories.title")}</H>
          <p className="lead">{t("territories.body")}</p>
          <div style={{ marginTop: 12 }}>
            <SearchBar />
          </div>
        </Reveal>
        <Reveal delay={150} className="regions">
          <ol>
            {Object.entries(REGIONS).map(([region, provinces], i) => {
              const n = counts?.[region];
              return (
                <li key={region} className={counts && !n ? "empty" : undefined}>
                  <Link href={`/${locale}/esplora?region=${encodeURIComponent(region)}`}>
                    <span className="region-n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="region-name">{region}</span>
                    <span className="region-p">
                      {n ? countLabel(locale, n) : provinces.map(([c]) => c).join(" · ")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
