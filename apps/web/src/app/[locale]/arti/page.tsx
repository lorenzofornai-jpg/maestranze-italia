import type { Metadata } from "next";
import type { SearchResult } from "@maestranze/shared";
import { Footer, Header } from "@/components/header";
import { ArtsSection } from "@/components/sections";
import { isLocale, translate } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: translate(isLocale(locale) ? locale : "it", "nav.arts") };
}

export default async function ArtsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const data = await serverApi<SearchResult>("/maisons");
  const counts = Object.fromEntries((data?.facets.disciplines ?? []).map((d) => [d.discipline, d.count]));
  return (
    <>
      <Header />
      <main className="section-page">
        <ArtsSection locale={locale} counts={counts} heading="h1" />
      </main>
      <Footer />
    </>
  );
}
