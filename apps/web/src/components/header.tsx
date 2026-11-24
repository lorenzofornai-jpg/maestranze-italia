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
  const { count } = useCart();

  // Sulle pagine pubbliche la testata scopre da sola se c'è una sessione aperta.
  useEffect(() => {
    if (signedIn) return;
    fetch("/api/v1/me", { credentials: "same-origin" })
      .then((r) => setSession(r.ok))
      .catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={`site-header ${overlay ? "overlay" : ""} ${dark ? "dark" : ""} ${scrolled ? "scrolled" : ""}`}>
      <div className="wrap header-row">
        <nav className="header-nav left">
          <Link href={`/${locale}#arti`}>{t("nav.arts")}</Link>
          <Link href={`/${locale}#territori`}>{t("nav.territories")}</Link>
          <Link href={`/${locale}/esplora`}>{t("nav.maisons")}</Link>
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
          <Link href={`/${locale}/${session ? "area" : "accedi"}`} className="signin">
            {t(session ? "nav.area" : "nav.signin")}
          </Link>
        </nav>
      </div>
    </header>
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
