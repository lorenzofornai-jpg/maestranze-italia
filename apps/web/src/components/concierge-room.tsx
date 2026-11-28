"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { pick, type ConciergeEvent, type ConciergeItem } from "@maestranze/shared";
import { useLocale, useT } from "@/lib/i18n-client";
import { ConciergeEmblem } from "@/components/concierge-emblem";

const STORE = "mi_concierge";

/** Testo del Concierge: paragrafi, e il grassetto con **…** se lo usa. */
export function Prose({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>
            {p.split(/(\*\*[^*]+\*\*)/).map((part, j): ReactNode =>
              part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <Fragment key={j}>{part.replace(/\*/g, "")}</Fragment>,
            )}
          </p>
        ))}
    </>
  );
}

function Item({ item, sessionId }: { item: ConciergeItem; sessionId: string | null }) {
  const t = useT();
  const locale = useLocale();
  if (item.kind === "guest")
    return (
      <li className="cg-guest">
        <span className="cg-who">{t("cg.guest")}</span>
        <p dir="auto">{item.text}</p>
      </li>
    );
  if (item.kind === "concierge")
    return (
      <li className="cg-line">
        <span className="cg-who">
          <ConciergeEmblem size={22} />
          {t("cg.name")}
        </span>
        <div className="cg-prose" dir="auto">
          <Prose text={item.text} />
        </div>
      </li>
    );
  if (item.kind === "maisons")
    return (
      <li className="cg-maisons">
        {item.maisons.map((m) => (
          <Link key={m.slug} href={`/${locale}/maison/${m.slug}`} className="cg-card">
            <span className={`cg-card-image swatch-${m.discipline.toLowerCase()}`}>
              {m.coverImage && <img src={`/api${m.coverImage}`} alt="" loading="lazy" />}
              {m.acceptsCommissions && <span className="cg-card-flag">{t("cg.bespoke")}</span>}
            </span>
            <span className="cg-card-body">
              <span className="cg-card-place">
                {t(`discipline.${m.discipline}`)} · {m.city}
              </span>
              <span className="cg-card-name">{m.name}</span>
              <span className="cg-card-tag">{pick(m.tagline, locale)}</span>
              <span className="cg-card-visit">
                {t("cg.visit")} <span className="arrow" />
              </span>
            </span>
          </Link>
        ))}
      </li>
    );
  const d = item.draft;
  const b = d.brief;
  return (
    <li className="cg-draft">
      <span className="eyebrow plain">{t("cg.draft.title", { maison: d.maison.name })}</span>
      <p className="cg-draft-lead">{t("cg.draft.body")}</p>
      <dl className="facts-list">
        {b.garment && (
          <>
            <dt>{t("req.garment")}</dt>
            <dd>{t(`garment.${b.garment}`)}</dd>
          </>
        )}
        {b.occasion && (
          <>
            <dt>{t("req.occasion")}</dt>
            <dd>{t(`occasion.${b.occasion}`)}</dd>
          </>
        )}
        {b.fabric && (
          <>
            <dt>{t("req.fabric")}</dt>
            <dd>{t(`fabric.${b.fabric}`)}</dd>
          </>
        )}
        {b.budget && (
          <>
            <dt>{t("req.budget")}</dt>
            <dd>{t(`budget.${b.budget}`)}</dd>
          </>
        )}
      </dl>
      {b.description && (
        <p className="cg-draft-text" dir="auto">
          «{b.description}»
        </p>
      )}
      {sessionId && (
        <Link href={`/${locale}/maison/${d.maison.slug}/su-misura?bozza=${d.id}&conversazione=${sessionId}`} className="btn">
          {t("cg.draft.open")} <span className="arrow" />
        </Link>
      )}
    </li>
  );
}

/**
 * Il salotto del Concierge: una stanza scura e calda, la conversazione scritta come in una lettera,
 * le schede delle botteghe e le bozze di richiesta che compaiono mentre il Concierge le prepara.
 */
export function ConciergeRoom() {
  const t = useT();
  const locale = useLocale();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<ConciergeItem[]>([]);
  const [live, setLive] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  // Il campanello suona una volta all'arrivo.
  const [greetRing, setGreetRing] = useState(false);
  useEffect(() => {
    const on = setTimeout(() => setGreetRing(true), 700);
    const off = setTimeout(() => setGreetRing(false), 2600);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, []);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHour(new Date().getHours());
    fetch("/api/v1/concierge/status")
      .then((r) => r.json())
      .then((r) => setEnabled(!!r.enabled))
      .catch(() => setEnabled(false));
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORE);
    } catch {}
    if (saved) {
      fetch(`/api/v1/concierge/sessions/${saved}`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => {
          if (r?.items) {
            setItems(r.items);
            setSessionId(r.sessionId);
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (items.length || live) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items.length, live]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy(true);
    setNotice(null);
    setText("");
    setItems((list) => [...list, { kind: "guest", text: message }]);
    let buffer = "";
    const flush = () => {
      const said = buffer.trim();
      buffer = "";
      setLive("");
      if (said) setItems((list) => [...list, { kind: "concierge", text: said }]);
    };
    try {
      const res = await fetch("/api/v1/concierge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ text: message, sessionId, locale }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.code ?? "generic");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as ConciergeEvent;
          if (e.type === "session") {
            setSessionId(e.sessionId);
            try {
              localStorage.setItem(STORE, e.sessionId);
            } catch {}
          } else if (e.type === "text") {
            buffer += e.delta;
            setLive(buffer);
          } else if (e.type === "item") {
            flush();
            setItems((list) => [...list, e.item]);
          } else if (e.type === "error") {
            throw new Error(e.code);
          } else if (e.type === "done") finished = true;
        }
      }
      flush();
      if (!finished) setNotice(t("cg.failed"));
    } catch (err) {
      flush();
      const code = (err as Error).message;
      setNotice(code === "CONCIERGE_LONG_CONVERSATION" ? t("cg.too_long") : code === "CONCIERGE_UNAVAILABLE" ? t("cg.unavailable") : t("cg.failed"));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const restart = () => {
    try {
      localStorage.removeItem(STORE);
    } catch {}
    setItems([]);
    setSessionId(null);
    setNotice(null);
  };

  const greeting = hour == null ? "" : hour >= 5 && hour < 17 ? t("cg.morning") : t("cg.evening");
  const empty = items.length === 0 && !live;

  return (
    <div className={`cg-room ${empty ? "empty" : ""}`}>
      <header className="cg-welcome">
        <span className="cg-mark">
          <ConciergeEmblem size={54} ring={greetRing} />
        </span>
        <span className="eyebrow">{t("cg.eyebrow")}</span>
        <h1 className="display cg-greeting">{greeting || " "}</h1>
        <p className="cg-intro">{t("cg.intro")}</p>
        <p className="cg-disclosure">{t("cg.disclosure")}</p>
      </header>

      {enabled === false && <p className="cg-notice">{t("cg.unavailable")}</p>}

      {!empty && (
        <ol className="cg-thread" aria-live="polite">
          {items.map((item, i) => (
            <Item key={i} item={item} sessionId={sessionId} />
          ))}
          {live && (
            <li className="cg-line">
              <span className="cg-who">
                <ConciergeEmblem size={22} ring />
                {t("cg.name")}
              </span>
              <div className="cg-prose" dir="auto">
                <Prose text={live} />
              </div>
            </li>
          )}
          {busy && !live && (
            <li className="cg-writing">
              <ConciergeEmblem size={30} ring />
              <span>{t("cg.writing")}</span>
            </li>
          )}
        </ol>
      )}
      <div ref={end} />

      {notice && <p className="cg-notice">{notice}</p>}

      {enabled !== false && (
        <form
          className="cg-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            ref={input}
            rows={1}
            value={text}
            dir="auto"
            maxLength={2000}
            placeholder={t("cg.placeholder")}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 220)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <button type="submit" className="cg-send" disabled={busy || !text.trim()} aria-label={t("cg.send")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      )}

      {empty && enabled !== false && (
        <ul className="cg-suggestions">
          {[1, 2, 3, 4].map((n) => (
            <li key={n}>
              <button type="button" onClick={() => send(t(`cg.suggest.${n}`))}>
                {t(`cg.suggest.${n}`)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!empty && (
        <button type="button" className="cg-restart" onClick={restart}>
          {t("cg.new")}
        </button>
      )}
    </div>
  );
}
