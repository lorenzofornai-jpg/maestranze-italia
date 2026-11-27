"use client";

import type { ReactNode } from "react";
import { useLocale, useT } from "@/lib/i18n-client";
import { Monogram, Wordmark } from "./brand";
import { LangSwitch } from "./header";

const QUOTES = {
  it: ["Ogni cosa ben fatta", "comincia da", "mani che sanno attendere."],
  en: ["Everything made well", "begins with", "hands that know how to wait."],
};

export function AuthShell({
  children,
  steps,
  current = 0,
  footer,
}: {
  children: ReactNode;
  steps?: string[];
  current?: number;
  footer?: ReactNode;
}) {
  const locale = useLocale();
  const t = useT();
  const [a, b, c] = QUOTES[locale];
  const roman = ["I", "II", "III", "IV", "V"];
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Wordmark locale={locale} tone="paper" />
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Monogram size={46} color="#a68a5b" />
          <p className="auth-quote">
            {a}
            <br />
            {b} <em>{c}</em>
          </p>
          {steps && (
            <ol className="auth-steps">
              {steps.map((s, i) => (
                <li key={s} className={i === current ? "current" : i < current ? "done" : ""}>
                  <span className="italic">{roman[i]}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <span className="small">{t("login.secure")}</span>
      </aside>
      <main className="auth-main">
        <div className="auth-top">
          <span className="auth-mobile-brand">
            <Wordmark locale={locale} />
          </span>
          <span />
          <LangSwitch />
        </div>
        {children}
        {footer && <div className="auth-foot">{footer}</div>}
      </main>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={`field ${error ? "invalid" : ""}`}>
      <label>
        {label}
        {children}
      </label>
      {error ? <span className="err">{t(error)}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

/** Sei caselle per il codice OTP, con incolla e avanzamento automatico. Non invia da sola: si conferma col pulsante. */
export function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const set = (next: string, focusIndex?: number, form?: HTMLElement | null) => {
    const clean = next.replace(/\D/g, "").slice(0, 6);
    onChange(clean);
    if (focusIndex !== undefined) (form?.querySelectorAll("input")[Math.min(focusIndex, 5)] as HTMLInputElement | undefined)?.focus();
  };
  return (
    <div className="otp" role="group" aria-label={t("mfa.code.label")}>
      {digits.map((d, i) => (
        <input
          key={i}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={6}
          value={d}
          autoFocus={i === 0}
          aria-label={`${t("mfa.code.label")} ${i + 1}`}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            const group = e.target.parentElement;
            if (v.length > 1) return set(v, v.length, group);
            const arr = digits.slice();
            arr[i] = v;
            set(arr.join(""), v ? i + 1 : i, group);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              const arr = digits.slice();
              arr[i - 1] = "";
              set(arr.join(""), i - 1, e.currentTarget.parentElement);
            }
          }}
        />
      ))}
    </div>
  );
}
