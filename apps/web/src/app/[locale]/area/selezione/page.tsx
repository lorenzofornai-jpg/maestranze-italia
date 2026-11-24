"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatEuro, pick, type PublicMaison, type PublicProduct } from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { Footer, Header } from "@/components/header";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type Application = PublicMaison & {
  submittedAt: string;
  commissionBps: number;
  applicant: { email: string; vatNumber: string | null; companyName: string | null };
  products: PublicProduct[];
};

export default function SelectionPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<Application[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ maisons: Application[] }>("/admin/maisons")).maisons);
    } catch (err) {
      if (err instanceof ApiFailure && (err.status === 401 || err.status === 403)) router.replace(`/${locale}/area`);
    }
  }, [router, locale]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0", minHeight: "70svh" }}>
        <div className="wrap" style={{ maxWidth: 1080, display: "flex", flexDirection: "column", gap: 40 }}>
          <Link href={`/${locale}/area`} className="link" style={{ alignSelf: "flex-start" }}>
            {t("nav.area")}
          </Link>
          <h1 className="display h2">{t("selection.title")}</h1>
          {msg && <p className="notice ok">{msg}</p>}
          {items?.length === 0 && <p className="italic lead">{t("selection.empty")}</p>}
          {items?.map((m) => (
            <Review
              key={m.id}
              m={m}
              onDone={(status) => {
                setMsg(t(`selection.done.${status}`));
                load();
              }}
            />
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}

function Review({ m, onDone }: { m: Application; onDone: (status: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const [commission, setCommission] = useState(String(m.commissionBps / 100));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: "APPROVE" | "REJECT") => {
    setErrors({});
    setError(null);
    try {
      const r = await api<{ status: string }>(`/admin/maisons/${m.id}/decision`, {
        body: { decision, note, commissionBps: Math.round(Number(commission.replace(",", ".")) * 100) },
      });
      onDone(r.status);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };

  return (
    <article className="review">
      <div className="review-cover">{m.coverImage && <img src={`/api${m.coverImage}`} alt="" />}</div>
      <div className="review-body">
        <span className="eyebrow">
          {t(`discipline.${m.discipline}`)} · {m.city} ({m.province}), {m.region}
        </span>
        <h2 className="display h3">{m.name}</h2>
        <p className="italic" style={{ fontSize: 20, margin: 0 }}>
          {pick(m.tagline, locale)}
        </p>
        <p className="small" style={{ margin: 0 }}>
          {t("selection.applicant")}: {m.applicant.companyName} · P.IVA {m.applicant.vatNumber} · {m.applicant.email}
        </p>
        <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)" }}>{pick(m.story, locale)}</p>
        {m.certifications.length > 0 && <p className="small">{m.certifications.map((c) => t(`cert.${c}`)).join(" · ")}</p>}
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          {m.products.map((p) => (
            <li key={p.id}>
              {pick(p.name, locale)} — {formatEuro(p.priceCents, locale)}
            </li>
          ))}
        </ul>
        <div className="grid-2">
          <Field label={t("selection.commission")} error={errors.commissionBps}>
            <input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} />
          </Field>
          <Field label={t("selection.note")} hint={t("selection.note.hint")} error={errors.note}>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {error && <p className="notice error">{error}</p>}
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => decide("APPROVE")}>
            {t("selection.approve")} <span className="arrow" />
          </button>
          <button className="link" onClick={() => decide("REJECT")}>
            {t("selection.reject")}
          </button>
        </div>
      </div>
    </article>
  );
}
