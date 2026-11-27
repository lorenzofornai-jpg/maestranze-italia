import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicMaison } from "@maestranze/shared";
import { BespokeRequest } from "@/components/bespoke-request";
import { Footer, Header } from "@/components/header";
import { isLocale, translate } from "@/lib/i18n";
import { serverApi } from "@/lib/server-api";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = isLocale(raw) ? raw : "it";
  const m = await serverApi<PublicMaison>(`/maisons/${encodeURIComponent(slug)}`);
  return m ? { title: `${translate(locale, "req.title")} · ${m.name}` } : {};
}

export default async function BespokePage({ params }: { params: Params }) {
  const { slug } = await params;
  const m = await serverApi<PublicMaison>(`/maisons/${encodeURIComponent(slug)}`);
  if (!m || !m.acceptsCommissions) notFound();
  return (
    <>
      <Header />
      <main className="bespoke-page">
        <div className="wrap">
          <BespokeRequest maison={{ id: m.id, slug: m.slug, name: m.name }} />
        </div>
      </main>
      <Footer />
    </>
  );
}
