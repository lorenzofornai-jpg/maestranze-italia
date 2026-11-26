"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { REGIONS, formatEuro, pick, type OrderView, type PricedOrder, type SessionUser } from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { Footer, Header } from "@/components/header";
import { PaymentAuthorization, type Authorization } from "@/components/payment-authorization";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { useLocale, useT } from "@/lib/i18n-client";

const media = (p: string | null | undefined) => (p ? `/api${p}` : null);

export default function CheckoutPage() {
  const t = useT();
  const locale = useLocale();
  const { cart, setQty, remove, clear } = useCart();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [quote, setQuote] = useState<PricedOrder | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [address, setAddress] = useState({ name: "", street: "", zip: "", city: "", province: "", phone: "", notes: "" });
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ order: OrderView; authorization: Authorization } | null>(null);
  const [paid, setPaid] = useState<OrderView | null>(null);

  useEffect(() => {
    api<{ user: SessionUser }>("/me")
      .then((r) => {
        setUser(r.user);
        setAddress((a) => ({ ...a, name: a.name || r.user.displayName }));
      })
      .catch(() => setUser(null));
  }, []);

  const items = cart?.lines.map((l) => ({ productId: l.productId, qty: l.qty })) ?? [];
  const itemsKey = JSON.stringify(items);

  // Totali sempre ricalcolati dal server (prezzi riservati, IVA per aliquota, minimi).
  const refreshQuote = useCallback(async () => {
    if (!cart || !user || user.role !== "BUYER") return;
    try {
      setQuote(await api<PricedOrder>("/orders/quote", { body: { maisonId: cart.maison.id, items: JSON.parse(itemsKey) } }));
      setQuoteError(null);
    } catch (err) {
      setQuote(null);
      if (err instanceof ApiFailure && err.code === "ORDER_BELOW_MINIMUM") {
        setQuoteError(t("order.min", { amount: formatEuro(Number(err.extra.minimumCents), locale) }));
      } else if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setQuoteError(Object.values(err.fields).map((k) => t(k)).join(" "));
      } else setQuoteError(errorMessage(t, err));
    }
  }, [cart, user, itemsKey, t, locale]);

  useEffect(() => {
    refreshQuote();
  }, [refreshQuote]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cart) return;
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const r = await api<{ order: OrderView; authorization: Authorization }>("/orders", {
        body: { maisonId: cart.maison.id, items, shippingAddress: { ...address, notes: address.notes || undefined }, note: note || undefined },
      });
      setPending(r);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace("shippingAddress.", ""), v])));
      }
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const restart = useCallback(async () => {
    if (!pending) return;
    try {
      const authorization = await api<Authorization>(`/orders/${pending.order.id}/authorize`, { body: {} });
      setPending({ ...pending, authorization });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }, [pending, t]);

  const bind = (k: keyof typeof address) => ({ value: address[k], onChange: (e: { target: { value: string } }) => setAddress({ ...address, [k]: e.target.value }) });

  return (
    <>
      <Header signedIn={!!user} />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0", minHeight: "80svh" }}>
        <div className="wrap" style={{ maxWidth: 1180 }}>
          {paid ? (
            <div className="checkout-done rise">
              <span className="eyebrow">{t("orders.number", { n: paid.number })}</span>
              <h1 className="display h2">{t("pay.done.title")}</h1>
              <p className="lead">{t("pay.done.body", { maison: paid.maison.name })}</p>
              <div>
                <Link className="btn" href={`/${locale}/area/ordini/${paid.id}`}>
                  {t("pay.view")} <span className="arrow" />
                </Link>
              </div>
            </div>
          ) : !cart ? (
            <div className="checkout-done rise">
              <span className="eyebrow">{t("order.title")}</span>
              <p className="lead italic" style={{ fontSize: 24 }}>
                {t("order.empty")}
              </p>
              <div>
                <Link className="btn" href={`/${locale}/maison`}>
                  {t("order.explore")} <span className="arrow" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="checkout">
              <section className="checkout-main">
                <span className="eyebrow rise">{t("order.title")}</span>
                <h1 className="display h2 rise">{t("order.from", { maison: cart.maison.name })}</h1>

                <div className="panel" style={{ paddingTop: 8 }}>
                  {cart.lines.map((l) => (
                    <div key={l.productId} className="product-row">
                      <div className="thumb">{media(l.image) && <img src={media(l.image)!} alt="" />}</div>
                      <div>
                        <div className="name">{pick(l.name, locale)}</div>
                        <div className="meta">{formatEuro(l.unitCents, locale)}</div>
                      </div>
                      <div className="actions" style={{ alignItems: "center" }}>
                        {!pending && (
                          <>
                            <div className="stepper">
                              <button type="button" onClick={() => setQty(l.productId, l.qty - 1)} aria-label="−">
                                −
                              </button>
                              <span>{l.qty}</span>
                              <button type="button" onClick={() => setQty(l.productId, l.qty + 1)} aria-label="+">
                                +
                              </button>
                            </div>
                            <button type="button" className="link" onClick={() => remove(l.productId)}>
                              {t("order.remove")}
                            </button>
                          </>
                        )}
                        {pending && <span className="small">× {l.qty}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {user === null && (
                  <div className="notice" style={{ marginTop: 40 }}>
                    <Link className="link" href={`/${locale}/accedi?next=${encodeURIComponent(`/${locale}/ordine`)}`}>
                      {t("order.signin")}
                    </Link>
                  </div>
                )}

                {user && !pending && (
                  <form className="panel" style={{ marginTop: 56 }} onSubmit={submit} noValidate id="checkout-form">
                    <span className="eyebrow plain">{t("order.shipping")}</span>
                    <div className="grid-2">
                      <Field label={t("order.address.name")} error={errors.name}>
                        <input {...bind("name")} autoComplete="name" />
                      </Field>
                      <Field label={t("field.phone")} error={errors.phone}>
                        <input {...bind("phone")} type="tel" autoComplete="tel" />
                      </Field>
                    </div>
                    <Field label={t("order.address.street")} error={errors.street}>
                      <input {...bind("street")} autoComplete="street-address" />
                    </Field>
                    <div className="grid-2">
                      <Field label={t("order.address.zip")} error={errors.zip}>
                        <input {...bind("zip")} inputMode="numeric" autoComplete="postal-code" maxLength={5} />
                      </Field>
                      <Field label={t("field.city")} error={errors.city}>
                        <input {...bind("city")} autoComplete="address-level2" />
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
                      <Field label={t("order.address.notes")}>
                        <input {...bind("notes")} />
                      </Field>
                    </div>
                    <Field label={t("order.note")}>
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                    </Field>
                  </form>
                )}
              </section>

              <aside className="checkout-summary">
                {pending ? (
                  <PaymentAuthorization
                    order={pending.order}
                    authorization={pending.authorization}
                    onRestart={restart}
                    onPaid={(o) => {
                      clear();
                      setPaid(o);
                    }}
                  />
                ) : (
                  <>
                    <span className="eyebrow plain">{t("order.summary")}</span>
                    {quote ? (
                      <dl className="totals">
                        <dt>{t("order.subtotal")}</dt>
                        <dd>{formatEuro(quote.subtotalCents, locale)}</dd>
                        <dt>{t("order.vat")}</dt>
                        <dd>{formatEuro(quote.vatCents, locale)}</dd>
                        <dt>{t("order.shipping_included")}</dt>
                        <dd>—</dd>
                        <dt className="grand">{t("order.total")}</dt>
                        <dd className="grand">{formatEuro(quote.totalCents, locale)}</dd>
                      </dl>
                    ) : (
                      <p className="small">{quoteError ?? " "}</p>
                    )}
                    {quote?.professional && <p className="small">{t("order.professional")}</p>}
                    <p className="small italic" style={{ fontSize: 16 }}>
                      {t("order.escrow")}
                    </p>
                    {error && <p className="notice error">{error}</p>}
                    {user && (
                      <button className="btn block" form="checkout-form" disabled={busy || !quote}>
                        {t("order.pay")} <span className="arrow" />
                      </button>
                    )}
                  </>
                )}
              </aside>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
