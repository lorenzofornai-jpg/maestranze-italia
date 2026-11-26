import type { Metadata } from "next";
import type { Territory } from "@maestranze/shared";
import { Footer, Header } from "@/components/header";
import { TerritoriesSection } from "@/components/sections";
import { isLocale, translate } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: translate(isLocale(locale) ? locale : "it", "nav.territories") };
}

export default async function TerritoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const data = await serverApi<{ territories: Territory[] }>("/territories");
  const counts = Object.fromEntries((data?.territories ?? []).map((r) => [r.region, r.count]));
  return (
    <>
      <Header />
      <main className="section-page">
        <TerritoriesSection locale={locale} counts={counts} heading="h1" />
      </main>
      <Footer />
    </>
  );
}
