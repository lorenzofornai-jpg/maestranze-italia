"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COUNTRY_CODES,
  RTL_LANGUAGES,
  formatEuro,
  languageName,
  splitDeposit,
  type CommissionMessageView,
  type CommissionView,
  type ContactKind,
  type OrderStatus,
  type ProposalView,
} from "@maestranze/shared";
import { Field } from "@/components/auth-shell";
import { ContactWarning, countryName, sortedCountries, useDictation } from "@/components/atelier-bits";
import { api, ApiFailure, errorMessage, toCents, uploadFile } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

type T = ReturnType<typeof useT>;

const dir = (lang: string | null) => (lang && RTL_LANGUAGES.includes(lang) ? "rtl" : "auto");

/** Testo tradotto con l'originale a portata di mano. */
function Translated({ text, original, lang, small }: { text: string; original: string | null; lang?: string | null; small?: boolean }) {
  const t = useT();
  const [showOriginal, setShowOriginal] = useState(false);
  const shown = showOriginal && original ? original : text;
  return (
    <>
      <p className={small ? "small" : undefined} dir={dir(showOriginal ? (lang ?? null) : null)} style={{ whiteSpace: "pre-wrap", margin: 0 }}>
        {shown}
      </p>
      {original && (
        <button type="button" className="tr-toggle" onClick={() => setShowOriginal((v) => !v)}>
          {showOriginal ? t("at.show_translation") : t("at.show_original")}
          {lang ? ` · ${languageName(lang)}` : ""}
        </button>
      )}
    </>
  );
}

// --- Conversazione ---------------------------------------------------------------------------------

function eventText(t: T, m: CommissionMessageView, locale: string) {
  const d = m.eventData ?? {};
  const total = typeof d.totalCents === "number" ? formatEuro(d.totalCents, locale) : "";
  const when =
    typeof d.startsAt === "string"
      ? new Date(d.startsAt).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";
  return t(`ev.${m.event}`, { ...d, total, when });
}

function Message({ m, c, locale }: { m: CommissionMessageView; c: CommissionView; locale: string }) {
  const t = useT();
  const time = new Date(m.createdAt).toLocaleString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (m.kind === "EVENT" && m.event !== "FITTING") {
    return (
      <li className="msg-event">
        <span>{eventText(t, m, locale)}</span>
        <time className="small">{time}</time>
      </li>
    );
  }
  const who = m.mine ? "" : m.author === "MAKER" ? c.maison.name : c.buyer.displayName;
  return (
    <li className={`msg ${m.mine ? "mine" : "theirs"} ${m.event === "FITTING" ? "fitting" : ""}`}>
      <div className="msg-meta small">
        {who && <span className="who">{who}</span>}
        <time>{time}</time>
        {m.dictated && <span>· {t("at.dictated")}</span>}
      </div>
      <div className="msg-body">
        {m.event === "FITTING" && <span className="eyebrow plain">{t("ev.FITTING")}</span>}
        {m.image && (
          <a href={`/api${m.image}`} target="_blank" rel="noreferrer" className="msg-image">
            <img src={`/api${m.image}`} alt="" loading="lazy" />
          </a>
        )}
        {m.text && <Translated text={m.text} original={m.original} lang={m.originalLanguage} />}
        {m.untranslated && <span className="tr-note">{t("at.untranslated")}</span>}
      </div>
    </li>
  );
}

function Composer({ c, onChange }: { c: CommissionView; onChange: (c: CommissionView) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [dictated, setDictated] = useState(false);
  const [warning, setWarning] = useState<ContactKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const dict = useDictation(c.viewerLanguage, (s) => {
    setText((v) => (v ? `${v.trimEnd()} ${s}` : s));
    setDictated(true);
  });

  const send = async (confirmContacts = false) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api<CommissionView>(`/commissions/${c.id}/messages`, { body: { text, dictated, confirmContacts } }));
      setText("");
      setDictated(false);
      setWarning(null);
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "CONTACT_WARNING") setWarning((err.extra.kinds as ContactKind[]) ?? []);
      else setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const photo = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadFile<CommissionView>(`/commissions/${c.id}/images`, f));
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="composer">
      {warning && <ContactWarning kinds={warning} onEdit={() => setWarning(null)} onSend={() => send(true)} />}
      <textarea
        rows={3}
        value={text}
        dir="auto"
        placeholder={dict.listening ? t("at.dictate.listening") : t(`at.composer.${c.viewer}`)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        maxLength={4000}
      />
      <div className="composer-bar">
        <div className="composer-tools">
          <button
            type="button"
            className={`tool ${dict.listening ? "on" : ""}`}
            onClick={() => (dict.supported ? (dict.listening ? dict.stop() : dict.start()) : setHint((v) => !v))}
            aria-pressed={dict.listening}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            {dict.listening ? t("at.dictate.stop") : t("at.dictate")}
          </button>
          <button type="button" className="tool" onClick={() => file.current?.click()} disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="6" width="18" height="14" rx="1" />
              <circle cx="12" cy="13" r="3.5" />
              <path d="M8 6l1.5-2h5L16 6" />
            </svg>
            {t("at.photo")}
          </button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => photo(e.target.files?.[0])} />
        </div>
        <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => send()}>
          {t("at.send")} <span className="arrow" />
        </button>
      </div>
      {hint && !dict.supported && <p className="small">{t("at.dictate.unsupported")}</p>}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

export function Conversation({ c, onChange, onCall }: { c: CommissionView; onChange: (c: CommissionView) => void; onCall: () => void }) {
  const t = useT();
  const locale = useLocale();
  const end = useRef<HTMLDivElement>(null);
  const count = c.messages.length;
  const first = useRef(true);
  // Ai nuovi messaggi si scende in fondo; all'apertura la pagina resta in alto.
  useEffect(() => {
    if (!first.current) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    first.current = false;
  }, [count]);
  const other = c.viewer === "BUYER" ? t("at.the_maker") : t("at.the_client");
  const theirs = c.viewer === "BUYER" ? c.languages.maker : c.languages.buyer;
  return (
    <section className="conversation">
      <div className="conversation-head">
        <div className="conversation-title">
          <span className="eyebrow">{t("at.conversation")}</span>
          {c.actions.includes("CALL") && (
            <button type="button" className="tool call-start" onClick={onCall} title={t("call.start.hint")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="7" width="13" height="10" rx="1" />
                <path d="M16 11l5-3v8l-5-3" />
              </svg>
              {t("call.start")}
            </button>
          )}
        </div>
        <p className="small" style={{ margin: 0 }}>
          {theirs === c.viewerLanguage
            ? t("at.languages.same", { lang: languageName(theirs) })
            : t("at.languages", { mine: languageName(c.viewerLanguage), other, theirs: languageName(theirs) })}
        </p>
      </div>
      <ol className="messages">
        {c.messages.map((m) => (
          <Message key={m.id} m={m} c={c} locale={locale} />
        ))}
      </ol>
      <div ref={end} />
      {c.actions.includes("MESSAGE") ? <Composer c={c} onChange={onChange} /> : <p className="small italic">{t("at.closed")}</p>}
    </section>
  );
}

// --- Brief e misure --------------------------------------------------------------------------------

export function BriefPanel({ c }: { c: CommissionView }) {
  const t = useT();
  const locale = useLocale();
  const b = c.brief;
  const m = c.measurements;
  const measured = m ? Object.entries(m).filter(([k, v]) => k !== "fit" && v != null) : [];
  return (
    <div className="side-panel">
      <span className="eyebrow plain">{t("at.brief")}</span>
      <p className="display brief-title">{t("at.brief.for", { garment: t(`garment.${b.garment}`), occasion: t(`occasion.${b.occasion}`) })}</p>
      <Translated text={b.descriptionShown} original={b.descriptionOriginal} lang={c.languages.buyer} />
      <dl className="facts-list">
        <dt>{t("at.brief.fabric")}</dt>
        <dd>{t(`fabric.${b.fabric}`)}</dd>
        {b.colour && (
          <>
            <dt>{t("at.brief.colour")}</dt>
            <dd>{b.colour}</dd>
          </>
        )}
        <dt>{t("at.brief.budget")}</dt>
        <dd>{t(`budget.${b.budget}`)}</dd>
        {b.neededBy && (
          <>
            <dt>{t("at.brief.needed_by")}</dt>
            <dd>{new Date(b.neededBy).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "long", year: "numeric" })}</dd>
          </>
        )}
        <dt>{t("at.brief.country")}</dt>
        <dd>{countryName(b.country, locale)}</dd>
      </dl>
      <span className="eyebrow plain" style={{ marginTop: 12 }}>
        {t("at.measures")}
      </span>
      {measured.length ? (
        <>
          <dl className="facts-list measures">
            {measured.map(([k, v]) => (
              <div key={k}>
                <dt>{t(`measure.${k}`)}</dt>
                <dd>
                  {String(v)} {k === "weightKg" ? "kg" : "cm"}
                </dd>
              </div>
            ))}
            {m?.fit && (
              <div>
                <dt>{t("measure.fit")}</dt>
                <dd>{t(`fit.${m.fit}`)}</dd>
              </div>
            )}
          </dl>
          <p className="small italic" style={{ margin: 0 }}>
            {t("at.measures.private")}
          </p>
        </>
      ) : (
        <p className="small italic" style={{ margin: 0 }}>
          {t("at.measures.none")}
        </p>
      )}
    </div>
  );
}

// --- Proposta --------------------------------------------------------------------------------------

function ProposalCard({ p, locale }: { p: ProposalView; locale: string }) {
  const t = useT();
  return (
    <div className="proposal">
      <div className="proposal-head">
        <span className="small">{t("pr.version", { n: p.version })}</span>
        <span className={`badge ${p.status === "ACCEPTED" ? "on" : ""} ${p.status === "SENT" ? "warn" : ""}`}>{t(`pr.status.${p.status}`)}</span>
      </div>
      <Translated text={p.description} original={p.original} />
      <dl className="totals">
        <dt className="grand">{t("pr.total")}</dt>
        <dd className="grand">{formatEuro(p.priceCents, locale)}</dd>
        <dt>{t("pr.deposit", { pct: p.depositPct })}</dt>
        <dd>{formatEuro(p.depositCents, locale)}</dd>
        <dt>{t("pr.balance")}</dt>
        <dd>{formatEuro(p.balanceCents, locale)}</dd>
        <dt>{t("pr.lead")}</dt>
        <dd>{t("pr.weeks", { n: p.leadTimeWeeks })}</dd>
        <dt>{t("pr.fittings")}</dt>
        <dd>{p.fittings}</dd>
      </dl>
    </div>
  );
}

function ProposalForm({ c, onChange, onClose }: { c: CommissionView; onChange: (c: CommissionView) => void; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const last = c.proposals.at(-1);
  const [f, setF] = useState({
    description: "",
    price: last ? String(last.priceCents / 100).replace(".", ",") : "",
    depositPct: String(last?.depositPct ?? 50),
    weeks: String(last?.leadTimeWeeks ?? 8),
    fittings: String(last?.fittings ?? 2),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<ContactKind[] | null>(null);
  const cents = toCents(f.price);
  const split = cents ? splitDeposit(cents, Number(f.depositPct) || 0) : null;
  const pct = (c.payout?.commissionBps ?? 0) / 100;

  const send = async (confirmContacts = false) => {
    setErrors({});
    setError(null);
    try {
      onChange(
        await api<CommissionView>(`/commissions/${c.id}/proposals`, {
          body: { description: f.description, priceCents: cents ?? 0, depositPct: Number(f.depositPct), leadTimeWeeks: Number(f.weeks), fittings: Number(f.fittings), confirmContacts },
        }),
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "CONTACT_WARNING") setWarning((err.extra.kinds as ContactKind[]) ?? []);
      else if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };

  return (
    <div className="side-form rise">
      <Field label={t("pr.description")} error={errors.description} hint={t("pr.description.hint")}>
        <textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Field label={t("pr.price")} error={errors.priceCents}>
        <input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="3.500,00" />
      </Field>
      <div className="grid-3">
        <Field label={t("pr.deposit_pct")} error={errors.depositPct}>
          <input inputMode="numeric" value={f.depositPct} onChange={(e) => setF({ ...f, depositPct: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label={t("pr.weeks_field")} error={errors.leadTimeWeeks}>
          <input inputMode="numeric" value={f.weeks} onChange={(e) => setF({ ...f, weeks: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label={t("pr.fittings_field")} error={errors.fittings}>
          <input inputMode="numeric" value={f.fittings} onChange={(e) => setF({ ...f, fittings: e.target.value.replace(/\D/g, "") })} />
        </Field>
      </div>
      {split && cents && (
        <p className="small" style={{ margin: 0 }}>
          {t("pr.preview", { deposit: formatEuro(split.depositCents, locale), balance: formatEuro(split.balanceCents, locale) })}
          <br />
          {t("pr.payout", { pct, amount: formatEuro(cents - Math.round((cents * pct) / 100), locale) })}
        </p>
      )}
      {warning && <ContactWarning kinds={warning} onEdit={() => setWarning(null)} onSend={() => send(true)} />}
      {error && <p className="notice error">{error}</p>}
      <div className="side-form-actions">
        <button type="button" className="btn" onClick={() => send()}>
          {t("pr.send")} <span className="arrow" />
        </button>
        <button type="button" className="link" onClick={onClose}>
          {t("act.cancel")}
        </button>
      </div>
    </div>
  );
}

export function ProposalPanel({ c, onChange, onAccept }: { c: CommissionView; onChange: (c: CommissionView) => void; onAccept: (address: Record<string, string>) => Promise<Record<string, string> | void> }) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<"none" | "compose" | "changes" | "accept">("none");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [addr, setAddr] = useState({ name: c.buyer.displayName, street: "", zip: "", city: "", province: "", country: c.brief.country, phone: "", notes: "" });
  const countries = useMemo(() => sortedCountries(COUNTRY_CODES, locale), [locale]);
  const current = c.proposals.filter((p) => p.status !== "SUPERSEDED").at(-1);
  const older = c.proposals.filter((p) => p !== current);
  const canPropose = c.actions.includes("PROPOSE");

  if (!current && !canPropose) return null;

  const changes = async () => {
    setErrors({});
    setError(null);
    try {
      onChange(await api<CommissionView>(`/commissions/${c.id}/request-changes`, { body: { note } }));
      setMode("none");
      setNote("");
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };

  const accept = async () => {
    setErrors({});
    setError(null);
    const fieldErrors = await onAccept(addr).catch((err) => {
      setError(errorMessage(t, err));
    });
    if (fieldErrors) setErrors(fieldErrors);
  };

  const bind = (k: keyof typeof addr) => ({ value: addr[k], onChange: (e: { target: { value: string } }) => setAddr({ ...addr, [k]: e.target.value }) });

  return (
    <div className="side-panel">
      <span className="eyebrow plain">{t("pr.title")}</span>
      {current && <ProposalCard p={current} locale={locale} />}
      {current?.status === "SENT" && c.viewer === "BUYER" && (
        <p className="small italic" style={{ margin: 0 }}>
          {t("pr.deposit_rule")}
        </p>
      )}

      {c.actions.includes("ACCEPT_PROPOSAL") && mode === "none" && (
        <div className="side-form-actions">
          <button type="button" className="btn block" onClick={() => setMode("accept")}>
            {t("pr.accept")} <span className="arrow" />
          </button>
          <button type="button" className="link" onClick={() => setMode("changes")}>
            {t("pr.changes")}
          </button>
        </div>
      )}

      {mode === "changes" && (
        <div className="side-form rise">
          <Field label={t("pr.changes.note")} error={errors.note}>
            <textarea rows={4} value={note} dir="auto" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="side-form-actions">
            <button type="button" className="btn" onClick={changes}>
              {t("pr.changes.send")}
            </button>
            <button type="button" className="link" onClick={() => setMode("none")}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "accept" && (
        <div className="side-form rise">
          <span className="eyebrow plain">{t("pr.address")}</span>
          <Field label={t("order.address.name")} error={errors.name}>
            <input {...bind("name")} autoComplete="name" />
          </Field>
          <Field label={t("order.address.street")} error={errors.street}>
            <input {...bind("street")} autoComplete="street-address" />
          </Field>
          <div className="grid-2 tight">
            <Field label={t("field.zip_any")} error={errors.zip}>
              <input {...bind("zip")} autoComplete="postal-code" />
            </Field>
            <Field label={t("field.city")} error={errors.city}>
              <input {...bind("city")} autoComplete="address-level2" />
            </Field>
          </div>
          <Field label={t("field.country")} error={errors.country}>
            <select {...bind("country")}>
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={addr.country === "IT" ? t("field.province") : t("field.region_any")} error={errors.province}>
            <input {...bind("province")} placeholder={addr.country === "IT" ? "NA" : ""} autoComplete="address-level1" />
          </Field>
          <Field label={addr.country === "IT" ? t("field.phone") : t("field.phone_intl")} error={errors.phone}>
            <input {...bind("phone")} inputMode="tel" autoComplete="tel" placeholder={addr.country === "IT" ? "333 123 4567" : "+1 212 555 0100"} />
          </Field>
          <Field label={t("order.address.notes")} error={errors.notes}>
            <input {...bind("notes")} />
          </Field>
          {error && <p className="notice error">{error}</p>}
          <div className="side-form-actions">
            <button type="button" className="btn block" onClick={accept}>
              {t("pr.accept.confirm")} <span className="arrow" />
            </button>
            <button type="button" className="link" onClick={() => setMode("none")}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}

      {canPropose && mode === "none" && (
        <button type="button" className={current ? "link" : "btn block"} onClick={() => setMode("compose")} style={{ alignSelf: current ? "flex-start" : undefined }}>
          {current ? t("pr.update") : t("pr.new")}
          {!current && <span className="arrow" />}
        </button>
      )}
      {mode === "compose" && <ProposalForm c={c} onChange={onChange} onClose={() => setMode("none")} />}
      {mode === "none" && error && <p className="notice error">{error}</p>}

      {older.length > 0 && (
        <details className="older">
          <summary className="small">
            {older.map((p) => t("pr.version", { n: p.version })).join(" · ")}
          </summary>
          {older.map((p) => (
            <ProposalCard key={p.id} p={p} locale={locale} />
          ))}
        </details>
      )}
    </div>
  );
}

// --- Pagamenti a tappe -----------------------------------------------------------------------------

function stageState(s: OrderStatus): string {
  if (s === "AWAITING_AUTHORIZATION") return "due";
  if (s === "DELIVERED" || s === "COMPLETED") return "released";
  if (s === "CANCELLED" || s === "REFUNDED") return "refunded";
  return "held";
}

export function PaymentsPanel({ c }: { c: CommissionView }) {
  const t = useT();
  const locale = useLocale();
  const agreed = c.proposals.find((p) => p.status === "ACCEPTED");
  if (!agreed) return null;
  const pct = c.payout ? c.payout.commissionBps / 100 : null;
  const net = (cents: number) => (pct != null ? cents - Math.round((cents * pct) / 100) : null);
  const rows: [string, number, string][] = [
    ["deposit", c.deposit?.totalCents ?? agreed.depositCents, c.deposit ? stageState(c.deposit.status) : "due"],
    ["balance", c.balance?.totalCents ?? agreed.balanceCents, c.balance ? stageState(c.balance.status) : c.status === "BALANCE_DUE" ? "due" : ""],
  ];
  const a = c.deliveryAddress;
  return (
    <div className="side-panel">
      <span className="eyebrow plain">{t("at.payments")}</span>
      <dl className="stages">
        {rows.map(([k, cents, state]) => (
          <div key={k} className={`stage ${state}`}>
            <dt>{t(`at.payments.${k}`)}</dt>
            <dd>
              <span className="price">{formatEuro(cents, locale)}</span>
              {state && <span className="small">{t(`at.payments.${state}`)}</span>}
              {net(cents) != null && <span className="small">{t("at.payments.net", { pct: pct! })}: {formatEuro(net(cents)!, locale)}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {c.balance?.trackingCode && <p className="small" style={{ margin: 0 }}>{t("at.tracking", { carrier: c.balance.carrier ?? "", code: c.balance.trackingCode })}</p>}
      {c.balance?.autoReleaseAt && (
        <p className="small" style={{ margin: 0 }}>
          {t("at.auto_release", { date: new Date(c.balance.autoReleaseAt).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB") })}
        </p>
      )}
      {a && (
        <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
          <span className="eyebrow plain" style={{ display: "block", marginBottom: 6 }}>
            {t("at.delivery_to")}
          </span>
          {a.name}
          <br />
          {a.street}
          <br />
          {a.zip} {a.city} {a.province ? `(${a.province})` : ""}
          <br />
          {countryName(a.country, locale)} · {a.phone}
        </p>
      )}
    </div>
  );
}

// --- Percorso ------------------------------------------------------------------------------------

const STEP_INDEX: Record<string, number> = {
  REQUESTED: 0,
  IN_DIALOGUE: 0,
  PROPOSED: 1,
  DEPOSIT_DUE: 2,
  DEPOSIT_PAID: 2,
  IN_WORK: 3,
  BALANCE_DUE: 4,
  BALANCE_PAID: 4,
  SHIPPED: 5,
  DISPUTED: 5,
  COMPLETED: 6,
  REFUNDED: 6,
};

export function Steps({ phase }: { phase: string }) {
  const t = useT();
  const at = STEP_INDEX[phase];
  if (at == null) return null;
  const steps = ["dialogue", "proposal", "deposit", "work", "balance", "delivery"];
  return (
    <>
    <ol className="at-steps">
      {steps.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "current" : undefined}>
          <span className="dot" />
          <span>{t(`at.steps.${s}`)}</span>
        </li>
      ))}
    </ol>
    {steps[at] && <p className="at-steps-current">{`${at + 1} / ${steps.length} · ${t(`at.steps.${steps[at]}`)}`}</p>}
    </>
  );
}

// --- Appuntamenti per la videochiamata ---------------------------------------------------------------

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function fmt(iso: string, locale: string, timeZone?: string | null) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Date(iso).toLocaleString(locale === "it" ? "it-IT" : "en-GB", timeZone ? { ...opts, timeZone } : opts);
  } catch {
    return new Date(iso).toLocaleString(locale === "it" ? "it-IT" : "en-GB", opts);
  }
}

export function AppointmentsPanel({ c, onChange, onCall }: { c: CommissionView; onChange: (c: CommissionView) => void; onCall: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("30");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const visible = c.appointments.filter((a) => a.status === "PROPOSED" || (a.status === "ACCEPTED" && new Date(a.startsAt).getTime() + a.durationMin * 60_000 > Date.now()));
  if (!c.actions.includes("SCHEDULE") && visible.length === 0) return null;

  const propose = async () => {
    setErrors({});
    setError(null);
    try {
      const startsAt = when ? new Date(when).toISOString() : "";
      onChange(await api<CommissionView>(`/commissions/${c.id}/appointments`, { body: { startsAt, durationMin: Number(duration), timeZone: localZone() } }));
      setOpen(false);
      setWhen("");
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "VALIDATION_FAILED") setErrors(err.fields);
      else setError(errorMessage(t, err));
    }
  };
  const respond = async (id: string, accept: boolean) => {
    setError(null);
    try {
      onChange(await api<CommissionView>(`/appointments/${id}/respond`, { body: { accept, timeZone: localZone() } }));
      if (!accept) setOpen(true);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <div className="side-panel">
      <span className="eyebrow plain">{t("appt.title")}</span>
      {visible.map((a) => {
        const soon = a.status === "ACCEPTED" && Math.abs(new Date(a.startsAt).getTime() - Date.now()) < 15 * 60_000;
        return (
          <div key={a.id} className="appointment">
            <div className="proposal-head">
              <span className={`badge ${a.status === "ACCEPTED" ? "on" : "warn"}`}>{t(`appt.status.${a.status}`)}</span>
              <span className="small">{t("appt.minutes", { n: a.durationMin })}</span>
            </div>
            <p className="appointment-when">{fmt(a.startsAt, locale)}</p>
            {a.otherTimeZone && a.otherTimeZone !== localZone() && <p className="small" style={{ margin: 0 }}>{t("appt.their_time", { time: fmt(a.startsAt, locale, a.otherTimeZone) })}</p>}
            {a.status === "PROPOSED" && !a.mine && (
              <div className="side-form-actions">
                <button type="button" className="btn" onClick={() => respond(a.id, true)}>
                  {t("appt.accept")}
                </button>
                <button type="button" className="link" onClick={() => respond(a.id, false)}>
                  {t("appt.decline")}
                </button>
              </div>
            )}
            {soon && (
              <button type="button" className="btn block" onClick={onCall}>
                {t("appt.join")} <span className="arrow" />
              </button>
            )}
          </div>
        );
      })}
      {c.actions.includes("SCHEDULE") && !open && (
        <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
          {t("appt.propose")}
        </button>
      )}
      {open && (
        <div className="side-form rise">
          <Field label={t("appt.when")} error={errors.startsAt} hint={t("appt.when.hint", { tz: localZone() })}>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label={t("appt.duration")}>
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[20, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {t("appt.minutes", { n })}
                </option>
              ))}
            </select>
          </Field>
          <div className="side-form-actions">
            <button type="button" className="btn" onClick={propose}>
              {t("appt.send")}
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              {t("act.cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}
