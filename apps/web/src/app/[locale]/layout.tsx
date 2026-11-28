import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/300-italic.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/jost/300.css";
import "@fontsource/jost/400.css";
import "../globals.css";
import "../site.css";
import "../catalog.css";
import "../atelier.css";
import "../concierge.css";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isLocale, translate } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n-client";

export function generateStaticParams() {
  return [{ locale: "it" }, { locale: "en" }];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const l = isLocale(locale) ? locale : "it";
  return {
    title: { default: "Maestranze Italia", template: "%s · Maestranze Italia" },
    description: translate(l, "footer.tagline"),
    alternates: { languages: { it: "/it", en: "/en" } },
  };
}

export const viewport: Viewport = { themeColor: "#f4eee2", width: "device-width", initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
