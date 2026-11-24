"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CERTIFICATIONS,
  DISCIPLINES,
  PRODUCT_UNITS,
  REGIONS,
  VAT_RATES,
  formatEuro,
  pick,
  type I18nText,
  type MaisonStatus,
  type PublicMaison,
  type PublicProduct,
} from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { Footer, Header } from "@/components/header";
import { api, ApiFailure, errorMessage, fromCents, toCents, uploadFile } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type MyMaison = PublicMaison & { status: MaisonStatus; reviewNote: string | null; commissionBps: number };
type MyProduct = PublicProduct & { stock: number | null; active: boolean };
type Lang = "it" | "en";

const media = (p: string | null | undefined) => (p ? `/api${p}` : null);

/** Campo bilingue: una scheda per lingua. L'inglese è facoltativo. */
function I18nField({
  label,
  hint,
  value,
  onChange,
  lang,
  error,
  multiline,
}: {
  label: string;
  hint?: string;
  value: I18nText;
  onChange: (v: I18nText) => void;
  lang: Lang;
  error?: string;
  multiline?: boolean;
}) {
  const v = value[lang] ?? "";
  const set = (text: string) => onChange({ ...value, [lang]: text });
  return (
    <Field label={`${label} · ${lang.toUpperCase()}`} hint={hint} error={error}>
      {multiline ? <textarea value={v} onChange={(e) => set(e.target.value)} rows={7} /> : <input value={v} onChange={(e) => set(e.target.value)} />}
    </Field>
  );
}

const emptyText = (): I18nText => ({ it: "", en: "" });

export default function MaisonEditor() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [maison, setMaison] = useState<MyMaison | null>(null);
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [lang, setLang] = useState<Lang>("it");
  const [form, setForm] = useState({
    name: "",
    discipline: "",
    tagline: emptyText(),
    story: emptyText(),
    craft: emptyText(),
    foundedYear: "",
    province: "",
    city: "",
    certifications: [] as string[],
    minOrder: "",
    leadTime: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MyProduct | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ maison: MyMaison | null; products: MyProduct[] }>("/me/maison");
      setMaison(r.maison);
      setProducts(r.products);
      if (r.maison) {
        const m = r.maison;
        setForm({
          name: m.name,
          discipline: m.discipline,
          tagline: { it: m.tagline.it, en: m.tagline.en ?? "" },
          story: { it: m.story.it, en: m.story.en ?? "" },
          craft: { it: m.craft?.it ?? "", en: m.craft?.en ?? "" },
          foundedYear: m.foundedYear ? String(m.foundedYear) : "",
          province: m.province,
          city: m.city,
          certifications: m.certifications,
          minOrder: fromCents(m.b2bMinOrderCents),
          leadTime: m.leadTimeDays ? String(m.leadTimeDays) : "",
        });
      }
      setLoaded(true);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi`);
      else if (err instanceof ApiFailure && err.status === 403) router.replace(`/${locale}/area`);
    }
  }, [router, locale]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    try {
      await api("/me/maison", {
        method: "PUT",
        body: {
          name: form.name,
          discipline: form.discipline,
          tagline: form.tagline,
          story: form.story,
          craft: form.craft.it || form.craft.en ? form.craft : undefined,
          foundedYear: form.foundedYear ? Number(form.foundedYear) : null,
          province: form.province,
          city: form.city,
          certifications: form.certifications,
          b2bMinOrderCents: toCents(form.minOrder),
          leadTimeDays: form.leadTime ? Number(form.leadTime) : null,
        },
      });
      setMsg({ kind: "ok", text: t("editor.saved") });
      load();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setErrors(err.fields);
        if (Object.keys(err.fields).some((k) => k.endsWith(".it"))) setLang("it");
      }
      setMsg({ kind: "error", text: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setMsg(null);
    try {
      await api("/me/maison/submit", { body: {} });
      setMsg({ kind: "ok", text: t("editor.submitted") });
      load();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") {
        setMsg({ kind: "error", text: Object.values(err.fields).map((k) => t(k)).join(" ") });
      } else setMsg({ kind: "error", text: errorMessage(t, err) });
    }
  };

  if (!loaded) return <div style={{ minHeight: "100svh", background: "var(--paper)" }} />;

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 110px) 0" }}>
        <div className="wrap editor" style={{ maxWidth: 980 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }} className="rise">
            <Link href={`/${locale}/area`} className="link" style={{ alignSelf: "flex-start" }}>
              {t("nav.area")}
            </Link>
            <h1 className="display h2">{maison?.name ?? t("editor.title")}</h1>
            {maison ? (
              <div className="status-banner">
                <span className={`badge ${maison.status === "APPROVED" ? "on" : ""}`}>{t(`editor.status.${maison.status}`)}</span>
                <p>{t(`editor.status.${maison.status}.body`, { note: maison.reviewNote ?? "" })}</p>
                {maison.status === "APPROVED" && (
                  <Link href={`/${locale}/maison/${maison.slug}`} className="link">
                    {t("editor.view_public")}
                  </Link>
                )}
                {(maison.status === "DRAFT" || maison.status === "REJECTED") && (
                  <button className="btn" onClick={submit}>
                    {t("editor.submit")} <span className="arrow" />
                  </button>
                )}
              </div>
            ) : (
              <p className="lead">{t("editor.first")}</p>
            )}
            {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
          </div>

          {/* --- Profilo --- */}
          <form className="panel" onSubmit={save} noValidate>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", flexWrap: "wrap", gap: 16 }}>
              <span className="eyebrow plain">{t("editor.profile")}</span>
              <div className="lang-tabs">
                {(["it", "en"] as const).map((l) => (
                  <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                    {t(`editor.lang.${l}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <Field label={t("editor.name")} error={errors.name}>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t("editor.discipline")} error={errors.discipline}>
                <select value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })}>
                  <option value="">{t("field.select")}</option>
                  {DISCIPLINES.map((d) => (
                    <option key={d} value={d}>
                      {t(`discipline.${d}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <I18nField label={t("editor.tagline")} value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} lang={lang} error={errors[`tagline.${lang}`]} />
            <I18nField
              label={t("editor.story")}
              hint={t("editor.story.hint")}
              value={form.story}
              onChange={(v) => setForm({ ...form, story: v })}
              lang={lang}
              error={errors[`story.${lang}`]}
              multiline
            />
            <I18nField label={t("editor.craft")} hint={t("editor.craft.hint")} value={form.craft} onChange={(v) => setForm({ ...form, craft: v })} lang={lang} multiline />
            <div className="grid-2">
              <Field label={t("field.province")} error={errors.province}>
                <select value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
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
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <Field label={t("editor.founded")} error={errors.foundedYear}>
                <input inputMode="numeric" value={form.foundedYear} onChange={(e) => setForm({ ...form, foundedYear: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label={t("editor.lead_time")} error={errors.leadTimeDays}>
                <input inputMode="numeric" value={form.leadTime} onChange={(e) => setForm({ ...form, leadTime: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label={t("editor.min_order")} error={errors.b2bMinOrderCents}>
                <input inputMode="decimal" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} />
              </Field>
            </div>
            <div className="field">
              <label>{t("editor.certifications")}</label>
              <div className="chips">
                {CERTIFICATIONS.map((c) => {
                  const on = form.certifications.includes(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      className="chip"
                      aria-pressed={on}
                      onClick={() =>
                        setForm({ ...form, certifications: on ? form.certifications.filter((x) => x !== c) : [...form.certifications, c] })
                      }
                    >
                      {t(`cert.${c}`)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <button className="btn" disabled={busy}>
                {t("editor.save")} <span className="arrow" />
              </button>
            </div>
          </form>

          {maison && (
            <>
              {/* --- Copertina --- */}
              <section className="panel">
                <span className="eyebrow plain">{t("editor.cover")}</span>
                <div className="cover-preview">
                  {media(maison.coverImage) ? <img src={media(maison.coverImage)!} alt="" /> : <span className="italic">{t("editor.cover.hint")}</span>}
                </div>
                <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                  <label className="btn ghost file-btn">
                    {t("editor.cover.upload")}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          await uploadFile("/me/maison/cover", f);
                          load();
                        } catch (err) {
                          setMsg({ kind: "error", text: errorMessage(t, err) });
                        }
                      }}
                    />
                  </label>
                  <span className="small">{t("editor.cover.hint")}</span>
                </div>
              </section>

              {/* --- Collezione --- */}
              <section className="panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="eyebrow plain">{t("editor.products")}</span>
                  <button className="link" onClick={() => setEditing("new")}>
                    + {t("editor.product.new")}
                  </button>
                </div>
                {products.length === 0 && <p className="italic small" style={{ fontSize: 18 }}>{t("editor.products.none")}</p>}
                {products.map((p) => (
                  <div key={p.id} className="product-row">
                    <div className="thumb">{media(p.image) && <img src={media(p.image)!} alt="" />}</div>
                    <div>
                      <div className="name">{pick(p.name, locale)}</div>
                      <div className="meta">
                        {formatEuro(p.priceCents, locale)}
                        {p.b2bPriceCents != null && ` · ${t("maison.b2b_price")} ${formatEuro(p.b2bPriceCents, locale)}`}
                        {p.madeToOrder && ` · ${t("maison.made_to_order")}`}
                        {!p.active && ` · ${t("editor.inactive")}`}
                      </div>
                    </div>
                    <div className="actions">
                      <button className="link" onClick={() => setEditing(p)}>
                        {t("editor.product.edit")}
                      </button>
                      <button
                        className="link"
                        onClick={async () => {
                          await api(`/me/products/${p.id}`, { method: "DELETE" });
                          load();
                        }}
                      >
                        {t("editor.product.delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </main>
      {editing && (
        <ProductDrawer
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <Footer />
    </>
  );
}

function ProductDrawer({ product, onClose, onSaved }: { product: MyProduct | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [lang, setLang] = useState<Lang>("it");
  const [name, setName] = useState<I18nText>({ it: product?.name.it ?? "", en: product?.name.en ?? "" });
  const [description, setDescription] = useState<I18nText>({ it: product?.description.it ?? "", en: product?.description.en ?? "" });
  const [price, setPrice] = useState(fromCents(product?.priceCents));
  const [b2b, setB2b] = useState(fromCents(product?.b2bPriceCents));
  const [unit, setUnit] = useState<string>(product?.unit ?? "PIECE");
  const [minQty, setMinQty] = useState(String(product?.minQty ?? 1));
  const [stock, setStock] = useState(product?.stock == null ? "" : String(product.stock));
  const [madeToOrder, setMadeToOrder] = useState(product?.madeToOrder ?? false);
  const [active, setActive] = useState(product?.active ?? true);
  const [vat, setVat] = useState(String(product?.vatRateBps ?? 2200));
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const body = {
        name,
        description,
        priceCents: toCents(price),
        b2bPriceCents: toCents(b2b),
        unit,
        minQty: Number(minQty) || 1,
        stock: stock === "" ? null : Number(stock),
        madeToOrder,
        active,
        vatRateBps: Number(vat),
      };
      const r = product
        ? await api<{ id: string }>(`/me/products/${product.id}`, { method: "PUT", body })
        : await api<{ id: string }>("/me/products", { body });
      if (file) await uploadFile(`/me/products/${r.id}/image`, file);
      onSaved();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <form className="drawer" onSubmit={save} noValidate role="dialog" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 className="display h3">{product ? pick(product.name, "it") : t("editor.product.new")}</h2>
          <button type="button" className="link" onClick={onClose}>
            {t("close")}
          </button>
        </div>
        <div className="lang-tabs">
          {(["it", "en"] as const).map((l) => (
            <button type="button" key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {t(`editor.lang.${l}`)}
            </button>
          ))}
        </div>
        <I18nField label={t("editor.product.name")} value={name} onChange={setName} lang={lang} error={errors[`name.${lang}`]} />
        <I18nField label={t("editor.product.description")} value={description} onChange={setDescription} lang={lang} error={errors[`description.${lang}`]} multiline />
        <div className="grid-2">
          <Field label={t("editor.product.price")} error={errors.priceCents}>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label={t("editor.product.b2b")} error={errors.b2bPriceCents}>
            <input inputMode="decimal" value={b2b} onChange={(e) => setB2b(e.target.value)} placeholder="0,00" />
          </Field>
          <Field label={t("editor.product.unit")}>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`unit.${u}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("editor.product.vat")} error={errors.vatRateBps}>
            <select value={vat} onChange={(e) => setVat(e.target.value)}>
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {t(`vat.${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("editor.product.min_qty")} error={errors.minQty}>
            <input inputMode="numeric" value={minQty} onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ""))} />
          </Field>
          {!madeToOrder && (
            <Field label={t("editor.product.stock")} hint={t("editor.product.stock.hint")} error={errors.stock}>
              <input inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))} />
            </Field>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={madeToOrder} onChange={(e) => setMadeToOrder(e.target.checked)} />
          <span>{t("editor.product.made_to_order")}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>{t("editor.product.active")}</span>
        </label>
        <div className="field">
          <label>{t("editor.product.image")}</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p className="notice error">{error}</p>}
        <div>
          <button className="btn" disabled={busy}>
            {t("editor.product.save")} <span className="arrow" />
          </button>
        </div>
      </form>
    </>
  );
}
