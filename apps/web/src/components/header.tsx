"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useLocale, useT } from "@/lib/i18n-client";
import { Wordmark } from "./brand";

/** Selettore di lingua IT | EN: stessa pagina, altra lingua. */
export function LangSwitch({ tone = "ink" }: { tone?: "ink" | "paper" }) {
  const locale = useLocale();
  const pathname = usePathname() ?? `/${locale}`;
  const swap = (l: string) => pathname.replace(/^\/(it|en)(?=\/|$)/, `/${l}`);
  const query = typeof window !== "undefined" ? window.location.search : "";
  return (
    <nav className={`lang ${tone}`} aria-label="Lingua / Language">
      <Link href={swap("it") + query} aria-current={locale === "it" ? "true" : undefined}>
        IT
      </Link>
      <span aria-hidden="true">|</span>
      <Link href={swap("en") + query} aria-current={locale === "en" ? "true" : undefined}>
        EN
      </Link>
    </nav>
  );
}

export function Header({ overlay = false, signedIn = false, dark = false }: { overlay?: boolean; signedIn?: boolean; dark?: boolean }) {
  const locale = useLocale();
  const t = useT();
  const [scrolled, setScrolled] = useState(false);
  const [session, setSession] = useState(signedIn);
  const [section, setSection] = useState<"arti" | "territori" | null>(null);
  const { count } = useCart();
  const pathname = usePathname() ?? "";
  const onHome = /^\/(it|en)\/?$/.test(pathname);

  // Sezione evidenziata nella testata: sulla home quella sotto gli occhi, altrove la pagina.
  useEffect(() => {
    if (!onHome) return setSection(null);
    const ids = ["arti", "territori"] as const;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        setSection(ids.find((id) => visible.get(id)) ?? null);
      },
      // Conta la fascia centrale dello schermo: la sezione «attiva» è quella che si sta leggendo.
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [onHome]);

  /** Sulla home le voci scorrono fino alla sezione invece di saltare (il salto fa sparire la testata su Safari iOS). */
  const goTo = (id: "arti" | "territori") => (e: React.MouseEvent) => {
    if (!onHome) return;
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };
  const current = (key: "arti" | "territori" | "maisons") =>
    (key === "maisons" ? /\/(esplora|maison)(\/|$)/.test(pathname) : section === key) ? "true" : undefined;

  // Sulle pagine pubbliche la testata scopre da sola se c'è una sessione aperta.
  useEffect(() => {
    if (signedIn) return;
    fetch("/api/v1/me", { credentials: "same-origin" })
      .then((r) => setSession(r.ok))
      .catch(() => undefined);
  }, [signedIn]);

  const [farDown, setFarDown] = useState(false);
  useEffect(() => {
    const on = () => {
      setScrolled(window.scrollY > 40);
      setFarDown(window.scrollY > window.innerHeight * 0.9);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <>
    <header className={`site-header ${overlay ? "overlay" : ""} ${dark ? "dark" : ""} ${scrolled ? "scrolled" : ""}`}>
      <div className="wrap header-row">
        <nav className="header-nav left">
          <Link href={`/${locale}#arti`} onClick={goTo("arti")} aria-current={current("arti")}>
            {t("nav.arts")}
          </Link>
          <Link href={`/${locale}#territori`} onClick={goTo("territori")} aria-current={current("territori")}>
            {t("nav.territories")}
          </Link>
          <Link href={`/${locale}/esplora`} aria-current={current("maisons")}>
            {t("nav.maisons")}
          </Link>
        </nav>
        <Wordmark locale={locale} />
        <nav className="header-nav right">
          <LangSwitch />
          {count > 0 && (
            <Link href={`/${locale}/ordine`} className="cart-link">
              {t("order.title")}
              <span className="cart-count">{count}</span>
            </Link>
          )}
          {session && (
            <button
              type="button"
              className="signout"
              onClick={async () => {
                await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
                window.location.href = `/${locale}`;
              }}
            >
              {t("area.logout")}
            </button>
          )}
          <Link href={`/${locale}/${session ? "area" : "accedi"}`} className="signin">
            {t(session ? "nav.area" : "nav.signin")}
          </Link>
        </nav>
      </div>
    </header>
    <button
      type="button"
      className={`to-top ${farDown ? "show" : ""}`}
      aria-label={t("nav.to_top")}
      title={t("nav.to_top")}
      tabIndex={farDown ? 0 : -1}
      onClick={() => {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
    </>
  );
}

export function Footer() {
  const locale = useLocale();
  const t = useT();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <Wordmark locale={locale} tone="paper" />
          <p className="italic footer-tag">{t("footer.tagline")}</p>
        </div>
        <nav className="footer-links">
          <Link href={`/${locale}/registrati`}>{t("nav.request")}</Link>
          <Link href={`/${locale}/accedi`}>{t("nav.signin")}</Link>
          <a href="mailto:concierge@maestranze.it">{t("footer.concierge")}</a>
        </nav>
        <nav className="footer-links">
          <a href="#">{t("footer.terms")}</a>
          <a href="#">{t("footer.privacy")}</a>
          <LangSwitch tone="paper" />
        </nav>
      </div>
      <div className="wrap footer-base">
        <span>© MMXXVI Maestranze Italia · {t("footer.rights")}</span>
      </div>
    </footer>
  );
}
