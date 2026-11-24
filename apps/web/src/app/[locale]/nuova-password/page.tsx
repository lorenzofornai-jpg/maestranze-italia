"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell, Field } from "@/components/auth-shell";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

function Reset() {
  const locale = useLocale();
  const t = useT();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  return (
    <AuthShell>
      <form
        className="auth-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setFieldError(undefined);
          try {
            await api("/auth/password/reset", { body: { token, password } });
            setDone(true);
          } catch (err) {
            if (err instanceof ApiFailure && err.fields.password) setFieldError(err.fields.password);
            else setError(errorMessage(t, err));
          }
        }}
      >
        <span className="eyebrow">{t("login.eyebrow")}</span>
        <h1 className="display h2">{t("reset.title")}</h1>
        {done ? (
          <>
            <p className="notice ok">{t("reset.done")}</p>
            <div>
              <Link className="btn" href={`/${locale}/accedi`}>
                {t("nav.signin")} <span className="arrow" />
              </Link>
            </div>
          </>
        ) : (
          <>
            <Field label={t("field.password")} hint={t("field.password.hint")} error={fieldError}>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
            {error && <p className="notice error">{error}</p>}
            <div className="auth-actions">
              <span />
              <button className="btn" disabled={!password}>
                {t("reset.submit")} <span className="arrow" />
              </button>
            </div>
          </>
        )}
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
