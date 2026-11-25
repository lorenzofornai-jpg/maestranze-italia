"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { LoginChallengeResponse, MfaMethod } from "@maestranze/shared";
import { AuthShell, Field, OtpInput } from "@/components/auth-shell";
import { Monogram } from "@/components/brand";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type Stage = "password" | "choose" | "code" | "push";

export default function LoginPage() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<LoginChallengeResponse | null>(null);
  const [method, setMethod] = useState<MfaMethod | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const verifying = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Dopo l'accesso si torna alla pagina di partenza (es. la cassa), solo se interna al sito.
  const done = useCallback(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next && next.startsWith(`/${locale}/`) && !next.startsWith("//") ? next : `/${locale}/area`);
  }, [router, locale]);

  const restart = () => {
    setStage("password");
    setChallenge(null);
    setMethod(null);
    setCode("");
  };

  const fail = (err: unknown) => {
    setError(errorMessage(t, err));
    if (err instanceof ApiFailure && err.code === "CHALLENGE_EXPIRED") restart();
  };

  const sendSms = async (c = challenge) => {
    if (!c) return;
    setError(null);
    try {
      const r = await api<{ devCode?: string }>("/auth/mfa/sms", { body: { loginToken: c.loginToken } });
      setDevCode(r.devCode ?? null);
      setCooldown(30);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "OTP_RATE_LIMITED") {
        setCooldown(Number(err.extra.retryAfterSeconds ?? 30));
      } else fail(err);
    }
  };

  const pick = async (m: MfaMethod, c = challenge) => {
    setMethod(m);
    setCode("");
    setError(null);
    if (m === "MOBILE_APP") {
      setStage("push");
      try {
        await api("/auth/mfa/push", { body: { loginToken: c!.loginToken } });
      } catch (err) {
        fail(err);
      }
    } else {
      setStage("code");
      if (m === "SMS") await sendSms(c);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await api<LoginChallengeResponse>("/auth/login", { body: { email, password } });
      setChallenge(c);
      setPassword("");
      // Il metodo più forte disponibile è proposto per primo, come nell'home banking.
      if (c.methods.length === 1) await pick(c.methods[0]!, c);
      else setStage("choose");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (!challenge || !method || value.length !== 6 || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/mfa/verify", { body: { loginToken: challenge.loginToken, method, code: value } });
      done();
    } catch (err) {
      setCode("");
      fail(err);
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  };

  // Attesa della conferma dall'app: il browser interroga l'esito ogni 2 secondi.
  useEffect(() => {
    if (stage !== "push" || !challenge) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api<{ status: string }>("/auth/mfa/push/poll", { body: { loginToken: challenge.loginToken } });
        if (r.status === "APPROVED") return done();
        if (r.status === "DENIED") {
          setError(t("mfa.push.denied"));
          return restart();
        }
        if (r.status === "EXPIRED") {
          setError(t("error.CHALLENGE_EXPIRED"));
          return restart();
        }
      } catch {
        /* rete instabile: si riprova */
      }
      setTimeout(tick, 2000);
    };
    const id = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [stage, challenge, done, t]);

  const enrollment = challenge?.status === "MFA_ENROLLMENT_REQUIRED";
  const phone = challenge?.maskedPhone ?? "";

  return (
    <AuthShell
      footer={
        stage === "password" ? (
          <>
            {t("login.no_account")}{" "}
            <Link className="link" href={`/${locale}/registrati`}>
              {t("nav.request")}
            </Link>
          </>
        ) : undefined
      }
    >
      {stage === "password" && (
        <form className="auth-body" onSubmit={submitPassword} noValidate>
          <span className="eyebrow">{t("login.eyebrow")}</span>
          <h1 className="display h2">{t("login.title")}</h1>
          <Field label={t("field.email")}>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label={t("field.password")}>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="notice error">{error}</p>}
          <div className="auth-actions">
            <Link className="link" href={`/${locale}/password-dimenticata`}>
              {t("login.forgot")}
            </Link>
            <button className="btn" disabled={busy || !email || !password}>
              {t("login.submit")} <span className="arrow" />
            </button>
          </div>
        </form>
      )}

      {stage === "choose" && challenge && (
        <div className="auth-body">
          <span className="eyebrow">{t("mfa.title")}</span>
          <h1 className="display h2">{t("mfa.choose")}</h1>
          <div className="choices stack">
            {challenge.methods.map((m) => (
              <button key={m} type="button" className="choice compact" onClick={() => pick(m)}>
                <span>
                  <span className="choice-title">{t(`mfa.method.${m}`)}</span>
                  <br />
                  <span className="choice-body">{t(`mfa.method.${m}.body`, { phone })}</span>
                </span>
                <span className="arrow" style={{ width: 22, height: 1, background: "currentColor" }} />
              </button>
            ))}
          </div>
          {error && <p className="notice error">{error}</p>}
          <div className="auth-actions">
            <button className="link" onClick={restart}>
              {t("mfa.restart")}
            </button>
          </div>
        </div>
      )}

      {stage === "code" && challenge && (
        <form
          className="auth-body"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <span className="eyebrow">{t("mfa.title")}</span>
          <h1 className="display h2">{enrollment ? t("mfa.enroll.title") : t(`mfa.method.${method}`)}</h1>
          <p className="lead">
            {enrollment
              ? t("mfa.enroll.body", { phone })
              : method === "SMS"
                ? t("mfa.code.sent", { phone })
                : t("mfa.method.TOTP.body")}
          </p>
          {method === "SMS" && devCode && <p className="notice">{t("dev.sms_code", { code: devCode })}</p>}
          <OtpInput value={code} onChange={setCode} onComplete={verify} />
          {error && <p className="notice error">{error}</p>}
          <div className="auth-actions">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              {method === "SMS" &&
                (cooldown > 0 ? (
                  <span className="small">{t("mfa.code.resend_in", { s: cooldown })}</span>
                ) : (
                  <button type="button" className="link" onClick={() => sendSms()}>
                    {t("mfa.code.resend")}
                  </button>
                ))}
              {challenge.methods.length > 1 && (
                <button type="button" className="link" onClick={() => setStage("choose")}>
                  {t("mfa.other")}
                </button>
              )}
            </div>
            <button className="btn" disabled={busy || code.length !== 6}>
              {t("mfa.verify")} <span className="arrow" />
            </button>
          </div>
        </form>
      )}

      {stage === "push" && challenge && (
        <div className="auth-body">
          <span className="eyebrow">{t("mfa.title")}</span>
          <div className="pulse">
            <Monogram size={52} />
          </div>
          <h1 className="display h2">{t("mfa.push.waiting")}</h1>
          <p className="lead">{t("mfa.push.hint")}</p>
          {error && <p className="notice error">{error}</p>}
          <div className="auth-actions">
            <button className="link" onClick={() => setStage("choose")}>
              {t("mfa.other")}
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
