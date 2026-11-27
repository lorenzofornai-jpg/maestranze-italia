"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CommissionSummary, SessionUser } from "@maestranze/shared";
import { PhaseBadge } from "@/components/atelier-bits";
import { Footer, Header } from "@/components/header";
import { api, ApiFailure } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

export default function AtelierList() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [rows, setRows] = useState<CommissionSummary[] | null>(null);

  useEffect(() => {
    Promise.all([api<{ user: SessionUser }>("/me"), api<{ commissions: CommissionSummary[] }>("/commissions")])
      .then(([me, list]) => {
        setUser(me.user);
        setRows(list.commissions);
      })
      .catch((err) => {
        if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi?next=/${locale}/area/atelier`);
      });
  }, [router, locale]);

  const date = (d: string) => new Date(d).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" });
  const when = (d: string) => new Date(d).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0", minHeight: "70svh" }}>
        <div className="wrap" style={{ maxWidth: 1080, display: "flex", flexDirection: "column", gap: 32 }}>
          <Link href={`/${locale}/area`} className="link" style={{ alignSelf: "flex-start" }}>
            {t("nav.area")}
          </Link>
          <h1 className="display h2">{t("atelier.title")}</h1>
          {user && <p className="lead" style={{ margin: 0 }}>{t(`atelier.lead.${user.role}`)}</p>}
          {user && rows && rows.length === 0 && <p className="lead italic">{t(`atelier.none.${user.role}`)}</p>}
          {user && rows && rows.length > 0 && (
            <div className="orders-list">
              {rows.map((r) => (
                <Link key={r.id} href={`/${locale}/area/atelier/${r.id}`} className="order-row atelier-row">
                  <span className="mono">{r.number}</span>
                  <span className="name">
                    {user.role === "BUYER" ? r.maison : r.buyer}
                    <span className="small"> · {t(`garment.${r.garment}`)}</span>
                  </span>
                  <span className="small">
                    {r.unread > 0 ? <strong className="unread">{t("atelier.unread", { n: r.unread })}</strong> : date(r.updatedAt)}
                  </span>
                  <span className="small">{user.role === "MAKER" && r.phase === "REQUESTED" && !r.answered ? t("atelier.respond_by", { date: when(r.respondBy) }) : ""}</span>
                  <PhaseBadge phase={r.phase} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
