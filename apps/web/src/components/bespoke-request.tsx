"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BUDGETS,
  CONVERSATION_LANGUAGES,
  COUNTRY_CODES,
  FABRICS,
  FITS,
  GARMENTS,
  MEASUREMENTS,
  OCCASIONS,
  type ContactKind,
  type SessionUser,
} from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { ContactWarning, sortedCountries } from "@/components/atelier-bits";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type Step = 1 | 2 | 3;

/** Campo dell'errore → passo del modulo in cui si trova. */
const STEP_OF: Record<string, Step> = {
  "brief.garment": 1,
  "brief.occasion": 1,
  "brief.fabric": 1,
  "brief.colour": 1,
  "brief.description": 2,
  "brief.budget": 2,
  "brief.neededBy": 2,
  "brief.country": 2,
  language: 2,
};

export function BespokeRequest({ maison }: { maison: { id: string; slug: string; name: string } }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);
  const [brief, setBrief] = useState({ garment: "", occasion: "", fabric: "", colour: "", description: "", budget: "OPEN", neededBy: "", country: "" });
  const [language, setLanguage] = useState<string>(locale);
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<ContactKind[] | null>(null);
  const [busy, setBusy] = useState(false);
  const countries = useMemo(() => sortedCountries(COUNTRY_CODES, locale), [locale]);

  useEffect(() => {
    api<{ user: SessionUser }>("/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  // Paese suggerito dalla lingua del browser (es. en-US → Stati Uniti), modificabile.
  useEffect(() => {
    const region = navigator.language.split("-")[1]?.toUpperCase();
    if (region && COUNTRY_CODES.includes(region)) setBrief((b) => (b.country ? b : { ...b, country: region }));
  }, []);

  const set = (k: keyof typeof brief) => (v: string) => setBrief((b) => ({ ...b, [k]: v }));
  const measured = MEASUREMENTS.some(([k]) => measures[k]?.trim());

  const submit = async (confirmContacts = false) => {
    setBusy(true);
    setErrors({});
    setError(null);
    setWarning(null);
    const m: Record<string, number | string> = {};
    for (const [k] of MEASUREMENTS) if (measures[k]?.trim()) m[k] = Number(measures[k]!.replace(",", "."));
    if (measures.fit) m.fit = measures.fit;
    try {
      const r = await api<{ id: string }>("/commissions", {
        body: {
          maisonId: maison.id,
          language,
          brief: { ...brief, colour: brief.colour || undefined, neededBy: brief.neededBy || null, garment: brief.garment || undefined, occasion: brief.occasion || undefined, fabric: brief.fabric || undefined, country: brief.country || undefined },
          measurements: Object.keys(m).length ? m : null,
          measurementsConsent: consent,
          confirmContacts,
        },
      });
      router.push(`/${locale}/area/atelier/${r.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiFailure && err.code === "CONTACT_WARNING") {
        setWarning((err.extra.kinds as ContactKind[]) ?? []);
        setStep(2);
      } else if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setErrors(err.fields);
        const first = Object.keys(err.fields)[0] ?? "";
        setStep(STEP_OF[first] ?? 3);
      } else setError(errorMessage(t, err));
    }
  };

  const err = (k: string) => errors[k];

  if (user === undefined) return <div style={{ minHeight: "50svh" }} />;

  if (!user || user.role !== "BUYER") {
    const next = `/${locale}/maison/${maison.slug}/su-misura`;
    return (
      <div className="bespoke-gate rise">
        <span className="eyebrow">{t("req.eyebrow", { maison: maison.name })}</span>
        <h1 className="display h2">{t("req.title")}</h1>
        {user ? (
          <p className="lead">{t("req.buyers_only")}</p>
        ) : (
          <>
            <p className="lead">{t("req.signin.body")}</p>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
              <Link href={`/${locale}/accedi?next=${encodeURIComponent(next)}`} className="btn">
                {t("req.signin")} <span className="arrow" />
              </Link>
              <Link href={`/${locale}/registrati`} className="link">
                {t("req.register")}
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  const Chips = ({ name, options, value, onPick, prefix }: { name: string; options: readonly string[]; value: string; onPick: (v: string) => void; prefix: string }) => (
    <div className="chips" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className="chip" onClick={() => onPick(o)}>
          {t(`${prefix}.${o}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="bespoke">
      <header className="bespoke-head rise">
        <span className="eyebrow">{t("req.eyebrow", { maison: maison.name })}</span>
        <h1 className="display h2">{t("req.title")}</h1>
        <p className="lead">{t("req.lead")}</p>
      </header>

      <ol className="bespoke-steps" aria-label={t("req.title")}>
        {([1, 2, 3] as Step[]).map((s) => (
          <li key={s} aria-current={step === s ? "step" : undefined} className={s < step ? "done" : undefined}>
            <button type="button" onClick={() => setStep(s)}>
              <span className="num">{String(s).padStart(2, "0")}</span>
              <span>{t(`req.step${s}`)}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="bespoke-panel fade" key="s1">
          <div className="bespoke-group">
            <span className="bespoke-label">{t("req.garment")}</span>
            <Chips name={t("req.garment")} options={GARMENTS} value={brief.garment} onPick={set("garment")} prefix="garment" />
            {err("brief.garment") && <span className="err small">{t(err("brief.garment")!)}</span>}
          </div>
          <div className="bespoke-group">
            <span className="bespoke-label">{t("req.occasion")}</span>
            <Chips name={t("req.occasion")} options={OCCASIONS} value={brief.occasion} onPick={set("occasion")} prefix="occasion" />
            {err("brief.occasion") && <span className="err small">{t(err("brief.occasion")!)}</span>}
          </div>
          <div className="bespoke-group">
            <span className="bespoke-label">{t("req.fabric")}</span>
            <Chips name={t("req.fabric")} options={FABRICS} value={brief.fabric} onPick={set("fabric")} prefix="fabric" />
            {err("brief.fabric") && <span className="err small">{t(err("brief.fabric")!)}</span>}
          </div>
          <Field label={t("req.colour")} error={err("brief.colour")}>
            <input value={brief.colour} onChange={(e) => set("colour")(e.target.value)} placeholder={t("req.colour.ph")} maxLength={200} />
          </Field>
          <div className="bespoke-nav">
            <span />
            <button type="button" className="btn" onClick={() => setStep(2)}>
              {t("req.next")} <span className="arrow" />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="bespoke-panel fade" key="s2">
          <Field label={t("req.description")} error={err("brief.description")} hint={t("req.description.hint")}>
            <textarea rows={6} value={brief.description} onChange={(e) => set("description")(e.target.value)} maxLength={3000} dir="auto" />
          </Field>
          {warning && <ContactWarning kinds={warning} onEdit={() => setWarning(null)} onSend={() => submit(true)} />}
          <div className="grid-2">
            <Field label={t("req.budget")} error={err("brief.budget")}>
              <select value={brief.budget} onChange={(e) => set("budget")(e.target.value)}>
                {BUDGETS.map((b) => (
                  <option key={b} value={b}>
                    {t(`budget.${b}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("req.needed_by")} error={err("brief.neededBy")} hint={t("req.optional")}>
              <input type="date" value={brief.neededBy} min={new Date().toISOString().slice(0, 10)} onChange={(e) => set("neededBy")(e.target.value)} />
            </Field>
            <Field label={t("req.country")} error={err("brief.country")}>
              <select value={brief.country} onChange={(e) => set("country")(e.target.value)}>
                <option value="">{t("field.select")}</option>
                {countries.map(([c, name]) => (
                  <option key={c} value={c}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("req.language")} error={err("language")} hint={t("req.language.hint")}>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {CONVERSATION_LANGUAGES.map(([c, name]) => (
                  <option key={c} value={c}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="bespoke-nav">
            <button type="button" className="link" onClick={() => setStep(1)}>
              {t("req.back")}
            </button>
            <button type="button" className="btn" onClick={() => setStep(3)}>
              {t("req.next")} <span className="arrow" />
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="bespoke-panel fade" key="s3">
          <p className="lead italic" style={{ margin: 0 }}>
            {t("req.measures.lead")}
          </p>
          <div className="measures-grid">
            {MEASUREMENTS.map(([k, min, max]) => (
              <div key={k} className={`field measure ${err(`measurements.${k}`) ? "invalid" : ""}`}>
                <label>
                  {t(`measure.${k}`)}
                  <span className="measure-input">
                    <input
                      inputMode="decimal"
                      value={measures[k] ?? ""}
                      onChange={(e) => setMeasures({ ...measures, [k]: e.target.value.replace(/[^\d.,]/g, "") })}
                      placeholder={`${min}–${max}`}
                    />
                    <span className="unit">{k === "weightKg" ? "kg" : "cm"}</span>
                  </span>
                </label>
                <span className="hint">{err(`measurements.${k}`) ? t(err(`measurements.${k}`)!) : t(`measure.${k}.how`)}</span>
              </div>
            ))}
          </div>
          <div className="bespoke-group">
            <span className="bespoke-label">{t("measure.fit")}</span>
            <Chips name={t("measure.fit")} options={FITS} value={measures.fit ?? ""} onPick={(v) => setMeasures({ ...measures, fit: v })} prefix="fit" />
          </div>
          {measured && (
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t("measure.consent")}</span>
            </label>
          )}
          {err("measurementsConsent") && <p className="notice error">{t(err("measurementsConsent")!)}</p>}
          {Object.keys(errors).length > 0 && !err("measurementsConsent") && <p className="notice error">{t("error.VALIDATION_FAILED")}</p>}
          {error && <p className="notice error">{error}</p>}
          <div className="bespoke-nav">
            <button type="button" className="link" onClick={() => setStep(2)}>
              {t("req.back")}
            </button>
            <button type="button" className="btn" disabled={busy || (measured && !consent)} onClick={() => submit(false)}>
              {t("req.send")} <span className="arrow" />
            </button>
          </div>
          <p className="small italic" style={{ textAlign: "right", margin: 0 }}>
            {t("req.promise")}
          </p>
        </section>
      )}
    </div>
  );
}
