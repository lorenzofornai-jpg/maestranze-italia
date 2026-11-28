import type { Metadata } from "next";
import { ConciergeRoom } from "@/components/concierge-room";
import { Footer, Header } from "@/components/header";
import { isLocale, translate } from "@/lib/i18n";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: raw } = await params;
  return { title: translate(isLocale(raw) ? raw : "it", "cg.eyebrow") };
}

export default function ConciergePage() {
  return (
    <>
      <Header overlay dark />
      <main className="concierge">
        <div className="wrap">
          <ConciergeRoom />
        </div>
      </main>
      <Footer />
    </>
  );
}
