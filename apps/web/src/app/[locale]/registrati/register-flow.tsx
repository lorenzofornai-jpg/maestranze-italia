"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BUYER_SECTORS, MAKER_SECTORS, REGIONS, registrationSchema } from "@maestranze/shared";
import { AuthShell, Field } from "@/components/auth-shell";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type Role = "BUYER" | "MAKER";
type Subject = "PERSON" | "COMPANY";

const STEP_FIELDS: Record<number, string[]> = {
  2: ["firstName", "lastName", "fiscalCode", "companyName", "vatNumber", "sector", "province", "city"],
  3: ["email", "password", "phone", "consents.terms", "consents.privacy"],
};

export function RegisterFlow() {
  const locale = useLocale();
  const t = useT();
  const params = useSearchParams();
  const preset = params.get("ruolo");
  const [step, setStep] = useState(preset ? 1 : 0);
  const [role, setRole] = useState<Role | null>(preset === "offerta" ? "MAKER" : preset === "domanda" ? "BUYER" : null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [consents, setConsents] = useState({ terms: false, privacy: false, marketing: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);

  const steps = [t("reg.steps.side"), t("reg.steps.subject"), t("reg.steps.details"), t("reg.steps.security")];
  const sectors = role === "MAKER" ? MAKER_SECTORS : BUYER_SECTORS;
  const bind = (name: string) => ({
    name,
    value: form[name] ?? "",
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [name]: e.target.value })),
  });

  const payload = () => ({
    role,
    subjectType: subject,
    ...form,
    locale,
    consents,
  });

  /** Valida sul client i campi del passo corrente con lo stesso schema usato dal server. */
  const validateStep = (s: number) => {
    const result = registrationSchema.safeParse(payload());
    const next: Record<string, string> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        if (STEP_FIELDS[s]?.includes(key)) next[key] ??= issue.message;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    if (!validateStep(3)) return;
    setBusy(true);
    try {
      await api("/auth/register", { body: payload() });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setErrors(err.fields);
        const firstStep = Object.keys(err.fields).some((k) => STEP_FIELDS[2]!.includes(k)) ? 2 : 3;
        setStep(firstStep);
      }
      setFailure(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell steps={steps} current={4}>
        <div className="auth-body">
          <span className="eyebrow">{t("reg.eyebrow")}</span>
          <h1 className="display h2">{t("reg.sent.title")}</h1>
          <p className="lead">{t("reg.sent.body", { email: form.email ?? "" })}</p>
          {resent ? (
            <p className="notice ok">{t("reg.sent.resent")}</p>
          ) : (
            <button
              className="link"
              style={{ alignSelf: "flex-start" }}
              onClick={async () => {
                await api("/auth/activation/resend", { body: { email: form.email } }).catch(() => undefined);
                setResent(true);
              }}
            >
              {t("reg.sent.resend")}
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      steps={steps}
      current={step}
      footer={
        <>
          {t("reg.have_account")}{" "}
          <Link className="link" href={`/${locale}/accedi`}>
            {t("nav.signin")}
          </Link>
        </>
      }
    >
      <form className="auth-body" onSubmit={submit} noValidate key={step}>
        <span className="eyebrow">
          {t("reg.eyebrow")} · {t("reg.step", { n: step + 1, total: 4 })}
        </span>

        {step === 0 && (
          <>
            <h1 className="display h2">{t("reg.side.title")}</h1>
            <div className="choices">
              {(["BUYER", "MAKER"] as const).map((r) => (
                <button
                  type="button"
                  key={r}
                  className="choice"
                  aria-pressed={role === r}
                  onClick={() => {
                    setRole(r);
                    setForm((f) => ({ ...f, sector: "" }));
                    if (r === "MAKER") setSubject("COMPANY");
                    setStep(1);
                  }}
                >
                  <span className="choice-label">{t(r === "BUYER" ? "worlds.buyer.label" : "worlds.maker.label")}</span>
                  <span className="choice-title">{t(r === "BUYER" ? "reg.side.buyer.title" : "reg.side.maker.title")}</span>
                  <span className="choice-body">{t(r === "BUYER" ? "reg.side.buyer.body" : "reg.side.maker.body")}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="display h2">{t("reg.subject.title")}</h1>
            <div className="choices">
              {(["PERSON", "COMPANY"] as const).map((s) => {
                const disabled = role === "MAKER" && s === "PERSON";
                return (
                  <button
                    type="button"
                    key={s}
                    className="choice"
                    aria-pressed={subject === s}
                    disabled={disabled}
                    style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                    onClick={() => {
                      setSubject(s);
                      setStep(2);
                    }}
                  >
                    <span className="choice-title">{t(s === "PERSON" ? "reg.subject.person" : "reg.subject.company")}</span>
                    <span className="choice-body">{t(s === "PERSON" ? "reg.subject.person.body" : "reg.subject.company.body")}</span>
                  </button>
                );
              })}
            </div>
            {role === "MAKER" && <p className="notice">{t("reg.subject.maker_note")}</p>}
            <div className="auth-actions">
              <button type="button" className="link" onClick={() => setStep(0)}>
                {t("reg.back")}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="display h2">{t(subject === "COMPANY" ? "reg.details.title.company" : "reg.details.title")}</h1>
            <div className="grid-2">
              {subject === "COMPANY" && (
                <>
                  <Field label={t("field.companyName")} error={errors.companyName}>
                    <input {...bind("companyName")} autoComplete="organization" />
                  </Field>
                  <Field label={t("field.vatNumber")} error={errors.vatNumber}>
                    <input {...bind("vatNumber")} inputMode="numeric" placeholder="IT 01234567890" />
                  </Field>
                </>
              )}
              <Field label={subject === "COMPANY" ? `${t("field.referent")} · ${t("field.firstName")}` : t("field.firstName")} error={errors.firstName}>
                <input {...bind("firstName")} autoComplete="given-name" />
              </Field>
              <Field label={t("field.lastName")} error={errors.lastName}>
                <input {...bind("lastName")} autoComplete="family-name" />
              </Field>
              {subject === "PERSON" && (
                <Field label={t("field.fiscalCode")} error={errors.fiscalCode}>
                  <input {...bind("fiscalCode")} style={{ textTransform: "uppercase" }} maxLength={16} />
                </Field>
              )}
              <Field label={t("field.sector")} error={errors.sector}>
                <select {...bind("sector")}>
                  <option value="">{t("field.select")}</option>
                  {sectors.map((s) => (
                    <option key={s} value={s}>
                      {t(`sector.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("field.province")} error={errors.province}>
                <select {...bind("province")}>
                  <option value="">{t("field.select")}</option>
                  {Object.entries(REGIONS).map(([region, list]) => (
                    <optgroup key={region} label={region}>
                      {list.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name} ({code})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label={t("field.city")} error={errors.city}>
                <input {...bind("city")} autoComplete="address-level2" />
              </Field>
            </div>
            <div className="auth-actions">
              <button type="button" className="link" onClick={() => setStep(1)}>
                {t("reg.back")}
              </button>
              <button type="button" className="btn" onClick={() => validateStep(2) && setStep(3)}>
                {t("reg.next")} <span className="arrow" />
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="display h2">{t("reg.security.title")}</h1>
            <p className="lead">{t("reg.security.body")}</p>
            <div className="grid-2">
              <Field label={t("field.email")} error={errors.email}>
                <input {...bind("email")} type="email" autoComplete="email" />
              </Field>
              <Field label={t("field.phone")} error={errors.phone} hint={t("field.phone.hint")}>
                <input {...bind("phone")} type="tel" autoComplete="tel" placeholder="+39 333 123 4567" />
              </Field>
            </div>
            <Field label={t("field.password")} error={errors.password} hint={t("field.password.hint")}>
              <input {...bind("password")} type="password" autoComplete="new-password" />
            </Field>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(["terms", "privacy", "marketing"] as const).map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={consents[c]} onChange={(e) => setConsents((v) => ({ ...v, [c]: e.target.checked }))} />
                  <span>
                    {t(`consent.${c}`)}
                    {errors[`consents.${c}`] && (
                      <span className="err" style={{ display: "block", color: "var(--error)", fontSize: 12 }}>
                        {t(errors[`consents.${c}`]!)}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            {failure && <p className="notice error">{failure}</p>}
            <div className="auth-actions">
              <button type="button" className="link" onClick={() => setStep(2)}>
                {t("reg.back")}
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {t("reg.submit")} <span className="arrow" />
              </button>
            </div>
          </>
        )}
      </form>
    </AuthShell>
  );
}
