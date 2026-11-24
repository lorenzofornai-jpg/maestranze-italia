"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthShell, Field } from "@/components/auth-shell";
import { api } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

export default function ForgotPage() {
  const locale = useLocale();
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <AuthShell>
      <form
        className="auth-body"
        onSubmit={async (e) => {
          e.preventDefault();
          await api("/auth/password/forgot", { body: { email } }).catch(() => undefined);
          setSent(true);
        }}
      >
        <span className="eyebrow">{t("login.eyebrow")}</span>
        <h1 className="display h2">{t("forgot.title")}</h1>
        <p className="lead">{t("forgot.body")}</p>
        {sent ? (
          <p className="notice ok">{t("forgot.sent")}</p>
        ) : (
          <Field label={t("field.email")}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
          </Field>
        )}
        <div className="auth-actions">
          <Link className="link" href={`/${locale}/accedi`}>
            {t("reg.back")}
          </Link>
          {!sent && (
            <button className="btn" disabled={!email}>
              {t("forgot.submit")} <span className="arrow" />
            </button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}
