"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatEuro, type OrderStatus } from "@maestranze/shared";
import { Footer, Header } from "@/components/header";
import { api, ApiFailure } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";
import { StatusBadge } from "@/components/status-badge";

interface Brief {
  id: string;
  number: string;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  maison: string;
}

export default function OrdersPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<{ orders: Brief[]; disputes: Brief[] } | null>(null);

  useEffect(() => {
    api<{ orders: Brief[]; disputes: Brief[] }>("/orders")
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi?next=/${locale}/area/ordini`);
      });
  }, [router, locale]);

  const date = (d: string) => new Date(d).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const List = ({ rows }: { rows: Brief[] }) => (
    <div className="orders-list">
      {rows.map((o) => (
        <Link key={o.id} href={`/${locale}/area/ordini/${o.id}`} className="order-row">
          <span className="mono">{o.number}</span>
          <span className="name">{o.maison}</span>
          <span className="small">{date(o.createdAt)}</span>
          <span className="price">{formatEuro(o.totalCents, locale)}</span>
          <StatusBadge status={o.status} />
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0", minHeight: "70svh" }}>
        <div className="wrap" style={{ maxWidth: 1080, display: "flex", flexDirection: "column", gap: 40 }}>
          <Link href={`/${locale}/area`} className="link" style={{ alignSelf: "flex-start" }}>
            {t("nav.area")}
          </Link>
          <h1 className="display h2">{t("orders.title")}</h1>
          {data && data.disputes.length > 0 && (
            <section className="panel">
              <span className="eyebrow plain">{t("orders.disputes")}</span>
              <List rows={data.disputes} />
            </section>
          )}
          {data && data.orders.length === 0 && <p className="lead italic">{t("orders.none")}</p>}
          {data && data.orders.length > 0 && <List rows={data.orders} />}
        </div>
      </main>
      <Footer />
    </>
  );
}
