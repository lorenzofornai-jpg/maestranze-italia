"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatEuro, pick, type OrderView } from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { Footer, Header } from "@/components/header";
import { PaymentAuthorization, type Authorization } from "@/components/payment-authorization";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";
import { StatusBadge } from "@/components/status-badge";

export default function OrderDetail() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [auth, setAuth] = useState<Authorization | null>(null);
  const [form, setForm] = useState<"SHIP" | "DISPUTE" | "DECLINE" | "RESOLVE" | null>(null);
  const [fields, setFields] = useState({ carrier: "", trackingCode: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await api<OrderView>(`/orders/${id}`));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi?next=/${locale}/area/ordini/${id}`);
      else setError(errorMessage(t, err));
    }
  }, [id, router, locale, t]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (path: string, body: object = {}) => {
    setErrors({});
    setError(null);
    try {
      setOrder(await api<OrderView>(`/orders/${id}/${path}`, { body }));
      setForm(null);
      setFields({ carrier: "", trackingCode: "", note: "" });
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };

  const startAuth = async () => {
    try {
      setAuth(await api<Authorization>(`/orders/${id}/authorize`, { body: {} }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  if (!order) return <div style={{ minHeight: "100svh", background: "var(--paper)" }}>{error && <p className="notice error">{error}</p>}</div>;

  const date = (d: string) => new Date(d).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const a = order.shippingAddress;

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0" }}>
        <div className="wrap order-detail" style={{ maxWidth: 1180 }}>
          <div className="order-head">
            <Link href={`/${locale}/area/ordini`} className="link">
              {t("orders.title")}
            </Link>
            <span className="eyebrow">{t("orders.number", { n: order.number })}</span>
            <h1 className="display h2">
              <Link href={`/${locale}/maison/${order.maison.slug}`}>{order.maison.name}</Link>
            </h1>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge status={order.status} />
              {order.trackingCode && <span className="small">{t("detail.tracking", { carrier: order.carrier ?? "", code: order.trackingCode })}</span>}
            </div>
            {order.autoReleaseAt && (
              <p className="small">{t("detail.auto_release", { date: new Date(order.autoReleaseAt).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB") })}</p>
            )}
          </div>

          <div className="checkout">
            <section className="checkout-main" style={{ display: "flex", flexDirection: "column", gap: 48 }}>
              <div className="panel">
                <span className="eyebrow plain">{t("detail.items")}</span>
                {order.lines.map((l, i) => (
                  <div key={i} className="line-row">
                    <span className="name">{pick(l.name, locale)}</span>
                    <span className="small">
                      {l.qty} × {formatEuro(l.unitNetCents, locale)} · {t("order.vat")} {l.vatRateBps / 100}%
                    </span>
                    <span className="price">{formatEuro(l.lineNetCents + l.lineVatCents, locale)}</span>
                  </div>
                ))}
              </div>
              <div className="grid-2">
                <div className="panel">
                  <span className="eyebrow plain">{t("detail.address")}</span>
                  <p style={{ margin: 0, lineHeight: 1.8 }}>
                    {a.name}
                    <br />
                    {a.street}
                    <br />
                    {a.zip} {a.city} ({a.province})
                    <br />
                    <span className="small">{a.phone}</span>
                    {a.notes && (
                      <>
                        <br />
                        <span className="small italic">{a.notes}</span>
                      </>
                    )}
                  </p>
                </div>
                {order.buyer?.email && (
                  <div className="panel">
                    <span className="eyebrow plain">{t("detail.buyer")}</span>
                    <p style={{ margin: 0, lineHeight: 1.8 }}>
                      {order.buyer.displayName}
                      <br />
                      <span className="small">{order.buyer.email}</span>
                      {order.buyer.vatNumber && (
                        <>
                          <br />
                          <span className="small">P.IVA {order.buyer.vatNumber}</span>
                        </>
                      )}
                    </p>
                  </div>
                )}
              </div>
              {order.note && <p className="italic lead">«{order.note}»</p>}
              <div className="panel">
                <span className="eyebrow plain">{t("detail.timeline")}</span>
                <ol className="timeline">
                  {order.events.map((e, i) => (
                    <li key={i}>
                      <span className="small">{date(e.createdAt)}</span>
                      <span>
                        {t(`status.${e.status}`)} <span className="small">· {t(`actor.${e.actor}`)}</span>
                      </span>
                      {e.note && e.note !== "auto" && <span className="small italic">{e.note}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <aside className="checkout-summary">
              {auth ? (
                <PaymentAuthorization
                  order={order}
                  authorization={auth}
                  onRestart={startAuth}
                  onPaid={(o) => {
                    setAuth(null);
                    setOrder(o);
                  }}
                />
              ) : (
                <>
                  <dl className="totals">
                    <dt>{t("order.subtotal")}</dt>
                    <dd>{formatEuro(order.subtotalCents, locale)}</dd>
                    <dt>{t("order.vat")}</dt>
                    <dd>{formatEuro(order.vatCents, locale)}</dd>
                    <dt className="grand">{t("order.total")}</dt>
                    <dd className="grand">{formatEuro(order.totalCents, locale)}</dd>
                    {order.commissionCents != null && (
                      <>
                        <dt>{t("detail.commission")}</dt>
                        <dd>− {formatEuro(order.commissionCents, locale)}</dd>
                        <dt>{t("detail.payout")}</dt>
                        <dd>{formatEuro(order.payoutCents!, locale)}</dd>
                      </>
                    )}
                  </dl>

                  <div className="order-actions">
                    {order.actions.includes("AUTHORIZE") && (
                      <button className="btn block" onClick={startAuth}>
                        {t("action.AUTHORIZE")} <span className="arrow" />
                      </button>
                    )}
                    {order.actions.includes("ACCEPT") && (
                      <button className="btn block" onClick={() => act("accept")}>
                        {t("action.ACCEPT")} <span className="arrow" />
                      </button>
                    )}
                    {order.actions.includes("SHIP") && (
                      <button className="btn block" onClick={() => setForm("SHIP")}>
                        {t("action.SHIP")} <span className="arrow" />
                      </button>
                    )}
                    {order.actions.includes("CONFIRM_DELIVERY") && (
                      <button className="btn block" onClick={() => act("confirm-delivery")}>
                        {t("action.CONFIRM_DELIVERY")} <span className="arrow" />
                      </button>
                    )}
                    {order.actions.includes("RESOLVE") && (
                      <button className="btn block" onClick={() => setForm("RESOLVE")}>
                        {t("action.RESOLVE.REFUND")} / {t("action.RESOLVE.RELEASE")}
                      </button>
                    )}
                    {order.actions.includes("DECLINE") && (
                      <button className="link" onClick={() => setForm("DECLINE")}>
                        {t("action.DECLINE")}
                      </button>
                    )}
                    {order.actions.includes("DISPUTE") && (
                      <button className="link" onClick={() => setForm("DISPUTE")}>
                        {t("action.DISPUTE")}
                      </button>
                    )}
                    {order.actions.includes("CANCEL") && (
                      <button className="link" onClick={() => act("cancel")}>
                        {t("action.CANCEL")}
                      </button>
                    )}
                  </div>

                  {form === "SHIP" && (
                    <div className="panel rise">
                      <Field label={t("ship.carrier")} error={errors.carrier}>
                        <input value={fields.carrier} onChange={(e) => setFields({ ...fields, carrier: e.target.value })} placeholder="BRT, GLS, Poste…" />
                      </Field>
                      <Field label={t("ship.tracking")} error={errors.trackingCode}>
                        <input value={fields.trackingCode} onChange={(e) => setFields({ ...fields, trackingCode: e.target.value })} />
                      </Field>
                      <button className="btn" onClick={() => act("ship", { carrier: fields.carrier, trackingCode: fields.trackingCode })}>
                        {t("action.SHIP")}
                      </button>
                    </div>
                  )}
                  {(form === "DISPUTE" || form === "DECLINE" || form === "RESOLVE") && (
                    <div className="panel rise">
                      <Field
                        label={t(form === "DISPUTE" ? "dispute.note" : form === "DECLINE" ? "decline.note" : "resolve.note")}
                        error={errors.note}
                      >
                        <textarea rows={4} value={fields.note} onChange={(e) => setFields({ ...fields, note: e.target.value })} />
                      </Field>
                      {form === "DISPUTE" && (
                        <button className="btn" onClick={() => act("dispute", { note: fields.note })}>
                          {t("action.DISPUTE")}
                        </button>
                      )}
                      {form === "DECLINE" && (
                        <button className="btn" onClick={() => act("decline", { note: fields.note })}>
                          {t("action.DECLINE")}
                        </button>
                      )}
                      {form === "RESOLVE" && (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <button className="btn" onClick={() => act("resolve", { decision: "REFUND", note: fields.note })}>
                            {t("action.RESOLVE.REFUND")}
                          </button>
                          <button className="btn ghost" onClick={() => act("resolve", { decision: "RELEASE", note: fields.note })}>
                            {t("action.RESOLVE.RELEASE")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {error && <p className="notice error">{error}</p>}
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
