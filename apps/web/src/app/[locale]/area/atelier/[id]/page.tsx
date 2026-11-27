"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CommissionView, OrderView } from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { PhaseBadge } from "@/components/atelier-bits";
import { BriefPanel, Conversation, PaymentsPanel, ProposalPanel, Steps } from "@/components/atelier-room";
import { Footer, Header } from "@/components/header";
import { PaymentAuthorization, type Authorization } from "@/components/payment-authorization";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type Payment = { order: OrderView; authorization: Authorization };
type Form = "DECLINE" | "FITTING" | "SHIP" | "DISPUTE" | "WITHDRAW" | "START_WORK" | "REQUEST_BALANCE" | null;

export default function AtelierRoom() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<CommissionView | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [fields, setFields] = useState({ note: "", carrier: "", trackingCode: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setC(await api<CommissionView>(`/commissions/${id}`));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi?next=/${locale}/area/atelier/${id}`);
      else setError(errorMessage(t, err));
    }
  }, [id, router, locale, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Nuovi messaggi: si ricarica ogni 20 secondi mentre la pagina è in primo piano.
  useEffect(() => {
    if (payment) return;
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20_000);
    return () => clearInterval(tick);
  }, [load, payment]);

  const act = async (path: string, body: object = {}) => {
    setErrors({});
    setError(null);
    try {
      setC(await api<CommissionView>(`/commissions/${id}/${path}`, { body }));
      setForm(null);
      setFields({ note: "", carrier: "", trackingCode: "" });
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };

  const pay = async (path: "pay-deposit" | "pay-balance") => {
    setError(null);
    try {
      setPayment(await api<Payment>(`/commissions/${id}/${path}`, { body: {} }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const accept = async (address: Record<string, string>) => {
    try {
      setPayment(await api<Payment>(`/commissions/${id}/accept`, { body: { address } }));
      await load();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") return err.fields;
      throw err;
    }
  };

  if (!c) return <div style={{ minHeight: "100svh", background: "var(--paper)" }}>{error && <p className="notice error">{error}</p>}</div>;

  const has = (a: CommissionView["actions"][number]) => c.actions.includes(a);
  const respondBy = new Date(c.respondBy).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const title = c.viewer === "BUYER" ? c.maison.name : c.buyer.displayName;

  const actions = (
    <div className="side-panel">
      <div className="order-actions">
        {has("PAY_DEPOSIT") && (
          <button className="btn block" onClick={() => pay("pay-deposit")}>
            {t("act.pay_deposit")} <span className="arrow" />
          </button>
        )}
        {has("PAY_BALANCE") && (
          <button className="btn block" onClick={() => pay("pay-balance")}>
            {t("act.pay_balance")} <span className="arrow" />
          </button>
        )}
        {has("START_WORK") && (
          <button className="btn block" onClick={() => setForm("START_WORK")}>
            {t("act.start_work")} <span className="arrow" />
          </button>
        )}
        {has("REQUEST_BALANCE") && (
          <button className="btn block" onClick={() => setForm("REQUEST_BALANCE")}>
            {t("act.request_balance")} <span className="arrow" />
          </button>
        )}
        {has("SHIP") && (
          <button className="btn block" onClick={() => setForm("SHIP")}>
            {t("act.ship")} <span className="arrow" />
          </button>
        )}
        {has("CONFIRM_DELIVERY") && (
          <button className="btn block" onClick={() => act("confirm-delivery")}>
            {t("act.confirm_delivery")} <span className="arrow" />
          </button>
        )}
        {has("LOG_FITTING") && (
          <button className="link" onClick={() => setForm("FITTING")}>
            {t("act.fitting")}
          </button>
        )}
        {has("DISPUTE") && (
          <button className="link" onClick={() => setForm("DISPUTE")}>
            {t("act.dispute")}
          </button>
        )}
        {has("DECLINE") && (
          <button className="link" onClick={() => setForm("DECLINE")}>
            {t("act.decline")}
          </button>
        )}
        {has("WITHDRAW") && (
          <button className="link" onClick={() => setForm("WITHDRAW")}>
            {t("act.withdraw")}
          </button>
        )}
      </div>

      {(form === "START_WORK" || form === "REQUEST_BALANCE" || form === "WITHDRAW") && (
        <div className="side-form rise">
          <p className="small" style={{ margin: 0 }}>
            {form === "START_WORK"
              ? t("act.start_work.hint")
              : form === "WITHDRAW"
                ? `${t("act.withdraw.confirm")} ${c.deposit?.status === "PAID" ? t("act.withdraw.refund") : ""}`
                : t("act.request_balance")}
          </p>
          <div className="side-form-actions">
            <button className="btn" onClick={() => act(form === "START_WORK" ? "start-work" : form === "WITHDRAW" ? "withdraw" : "request-balance")}>
              {t("act.confirm")}
            </button>
            <button className="link" onClick={() => setForm(null)}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}
      {form === "SHIP" && (
        <div className="side-form rise">
          <Field label={t("ship.carrier")} error={errors.carrier}>
            <input value={fields.carrier} onChange={(e) => setFields({ ...fields, carrier: e.target.value })} placeholder="DHL Express, UPS, FedEx…" />
          </Field>
          <Field label={t("ship.tracking")} error={errors.trackingCode}>
            <input value={fields.trackingCode} onChange={(e) => setFields({ ...fields, trackingCode: e.target.value })} />
          </Field>
          <div className="side-form-actions">
            <button className="btn" onClick={() => act("ship", { carrier: fields.carrier, trackingCode: fields.trackingCode })}>
              {t("act.ship")}
            </button>
            <button className="link" onClick={() => setForm(null)}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}
      {(form === "DECLINE" || form === "FITTING" || form === "DISPUTE") && (
        <div className="side-form rise">
          <Field label={t(form === "DECLINE" ? "act.decline.note" : form === "FITTING" ? "act.fitting.note" : "dispute.note")} error={errors.note}>
            <textarea rows={4} value={fields.note} dir="auto" onChange={(e) => setFields({ ...fields, note: e.target.value })} />
          </Field>
          <div className="side-form-actions">
            <button className="btn" onClick={() => act(form === "DECLINE" ? "decline" : form === "FITTING" ? "fittings" : "dispute", { note: fields.note })}>
              {t(form === "DECLINE" ? "act.decline" : form === "FITTING" ? "act.fitting" : "act.dispute")}
            </button>
            <button className="link" onClick={() => setForm(null)}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
  // Le azioni principali stanno in cima; ritiro e rifiuto, se sono le sole, in fondo.
  const secondary = ["MESSAGE", "PROPOSE", "ACCEPT_PROPOSAL", "REQUEST_CHANGES", "WITHDRAW", "DECLINE"];
  const hasActions = c.actions.some((a) => !secondary.includes(a));
  const onlySecondary = !hasActions && (has("WITHDRAW") || has("DECLINE"));

  return (
    <>
      <Header signedIn />
      <main className="atelier-page">
        <div className="wrap atelier-wrap">
          <div className="atelier-head">
            <Link href={`/${locale}/area/atelier`} className="link">
              {t("atelier.title")}
            </Link>
            <span className="eyebrow">{t("at.number", { n: c.number })}</span>
            <h1 className="display h2">
              {c.viewer === "BUYER" ? <Link href={`/${locale}/maison/${c.maison.slug}`}>{title}</Link> : title}
            </h1>
            <div className="atelier-status">
              <PhaseBadge phase={c.phase} />
              {c.phase === "REQUESTED" && !c.firstResponseAt && <span className="small">{t(`at.respond_by.${c.viewer}`, { date: respondBy })}</span>}
            </div>
            <Steps phase={c.phase} />
          </div>

          <div className="atelier-grid">
            <Conversation c={c} onChange={setC} />
            <aside className="atelier-side">
              {payment ? (
                <div className="side-panel">
                  <PaymentAuthorization
                    order={payment.order}
                    authorization={payment.authorization}
                    onRestart={() => pay(c.balance && c.phase === "BALANCE_DUE" ? "pay-balance" : "pay-deposit")}
                    onPaid={() => {
                      setPayment(null);
                      load();
                    }}
                  />
                  <button className="link" onClick={() => setPayment(null)} style={{ alignSelf: "flex-start" }}>
                    {t("act.cancel")}
                  </button>
                </div>
              ) : (
                <>
                  {hasActions && actions}
                  <ProposalPanel c={c} onChange={setC} onAccept={accept} />
                  <PaymentsPanel c={c} />
                  <BriefPanel c={c} />
                  {onlySecondary && actions}
                  {!hasActions && !onlySecondary && error && <p className="notice error">{error}</p>}
                </>
              )}
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
