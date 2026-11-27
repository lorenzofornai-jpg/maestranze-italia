"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEuro, type MfaMethod, type OrderView } from "@maestranze/shared";
import { OtpInput } from "@/components/auth-shell";
import { Monogram } from "@/components/brand";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

export interface Authorization {
  authToken: string;
  methods: MfaMethod[];
  maskedPhone: string;
  expiresAt: string;
}

/**
 * Autorizzazione forte del pagamento: stessi metodi dell'accesso (app, TOTP, SMS), ma la sfida è
 * legata a importo e beneficiario, che l'utente rivede qui, nell'SMS e sull'app.
 */
export function PaymentAuthorization({
  order,
  authorization,
  onPaid,
  onRestart,
}: {
  order: OrderView;
  authorization: Authorization;
  onPaid: (order: OrderView) => void;
  onRestart: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [method, setMethod] = useState<MfaMethod | null>(authorization.methods.length === 1 ? authorization.methods[0]! : null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const sentFor = useRef<string | null>(null);
  const base = `/orders/${order.id}/authorize`;
  const { authToken } = authorization;

  const fail = useCallback(
    (err: unknown) => {
      setError(errorMessage(t, err));
      if (err instanceof ApiFailure && err.code === "CHALLENGE_EXPIRED") onRestart();
    },
    [t, onRestart],
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Avvio del metodo scelto: SMS inviato una volta, notifica all'app.
  useEffect(() => {
    if (!method || sentFor.current === `${authToken}:${method}`) return;
    sentFor.current = `${authToken}:${method}`;
    if (method === "SMS") {
      api<{ devCode?: string }>(`${base}/sms`, { body: { authToken } })
        .then((r) => {
          setCooldown(30);
          setDevCode(r.devCode ?? null);
        })
        .catch(fail);
    } else if (method === "MOBILE_APP") {
      api(`${base}/push`, { body: { authToken } }).catch(fail);
    }
  }, [method, authToken, base, fail]);

  // Attesa dell'approvazione dall'app.
  useEffect(() => {
    if (method !== "MOBILE_APP") return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await api<{ status: string; order?: OrderView }>(`${base}/poll`, { body: { authToken } });
        if (r.status === "APPROVED" && r.order) return onPaid(r.order);
        if (r.status === "DENIED") return setError(t("pay.denied"));
        if (r.status === "EXPIRED") return onRestart();
      } catch (err) {
        if (err instanceof ApiFailure && err.code === "PAYMENT_FAILED") return fail(err);
      }
      setTimeout(tick, 2000);
    };
    const id = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [method, base, authToken, onPaid, onRestart, fail, t]);

  const verify = async (value = code) => {
    if (!method || value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onPaid(await api<OrderView>(`${base}/verify`, { body: { authToken, method, code: value } }));
    } catch (err) {
      setCode("");
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pay-box">
      <span className="eyebrow">{t("pay.title")}</span>
      <p className="pay-amount display">{formatEuro(order.totalCents, locale)}</p>
      <p className="lead">{t("pay.body", { amount: formatEuro(order.totalCents, locale), payee: order.maison.name })}</p>

      {!method && (
        <div className="choices stack">
          {authorization.methods.map((m) => (
            <button key={m} type="button" className="choice compact" onClick={() => setMethod(m)}>
              <span>
                <span className="choice-title">{t(`mfa.method.${m}`)}</span>
                <br />
                <span className="choice-body">{t(`mfa.method.${m}.body`, { phone: authorization.maskedPhone })}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {(method === "SMS" || method === "TOTP") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 24 }}
        >
          <p className="small">{method === "SMS" ? t("mfa.code.sent", { phone: authorization.maskedPhone }) : t("mfa.method.TOTP.body")}</p>
          {method === "SMS" && devCode && <p className="notice">{t("dev.sms_code", { code: devCode })}</p>}
          <OtpInput value={code} onChange={setCode} />
          <div className="auth-actions">
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {method === "SMS" &&
                (cooldown > 0 ? (
                  <span className="small">{t("mfa.code.resend_in", { s: cooldown })}</span>
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      api<{ devCode?: string }>(`${base}/sms`, { body: { authToken } })
                        .then((r) => {
          setCooldown(30);
          setDevCode(r.devCode ?? null);
        })
                        .catch(fail)
                    }
                  >
                    {t("mfa.code.resend")}
                  </button>
                ))}
              {authorization.methods.length > 1 && (
                <button type="button" className="link" onClick={() => setMethod(null)}>
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

      {method === "MOBILE_APP" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="pulse">
            <Monogram size={46} />
          </div>
          <h3 className="display h3">{t("pay.waiting")}</h3>
          <p className="small">{t("pay.waiting.hint")}</p>
          <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setMethod(null)}>
            {t("mfa.other")}
          </button>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}
