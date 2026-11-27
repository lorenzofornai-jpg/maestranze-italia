"use client";

import { useEffect, useRef, useState } from "react";
import type { ContactKind } from "@maestranze/shared";
import { useT } from "@/lib/i18n-client";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SPEECH_LOCALES: Record<string, string> = {
  it: "it-IT",
  en: "en-GB",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  pt: "pt-PT",
  nl: "nl-NL",
  sv: "sv-SE",
  pl: "pl-PL",
  el: "el-GR",
  ru: "ru-RU",
  tr: "tr-TR",
  ar: "ar-SA",
  he: "he-IL",
  hi: "hi-IN",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
};

/** Lingua del riconoscimento vocale: quella del browser se coincide, altrimenti la variante principale. */
export function speechLocale(lang: string) {
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.toLowerCase().startsWith(lang) ? nav : (SPEECH_LOCALES[lang] ?? lang);
}

/** Riconoscimento vocale del browser, se c'è (Safari e Chrome lo hanno, con prefisso). */
export function speechRecognition(): (new () => any) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Dettatura con il riconoscimento vocale del browser (Safari, Chrome): il testo compare nel campo,
 * chi scrive lo rilegge e lo invia. Nessun audio viene salvato dal portale.
 */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => rec.current?.abort?.();
  }, []);

  const start = () => {
    const w = window as any;
    const R = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    r.lang = speechLocale(lang);
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) cb.current(String(e.results[i][0].transcript).trim());
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  const stop = () => rec.current?.stop();
  return { supported, listening, start, stop };
}

/** Avviso gentile quando un testo contiene recapiti esterni: si può modificare o inviare comunque. */
export function ContactWarning({ kinds, onEdit, onSend }: { kinds: ContactKind[]; onEdit: () => void; onSend: () => void }) {
  const t = useT();
  const what = kinds.map((k) => t(`contact.${k}`)).join(", ");
  return (
    <div className="contact-warning rise" role="alert">
      <span className="eyebrow plain">{t("contact.title")}</span>
      <p>{t("contact.body", { what })}</p>
      <div className="contact-warning-actions">
        <button type="button" className="btn" onClick={onEdit}>
          {t("contact.edit")}
        </button>
        <button type="button" className="link" onClick={onSend}>
          {t("contact.send")}
        </button>
      </div>
    </div>
  );
}

/** Nome del paese nella lingua attiva. */
export function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale === "it" ? "it" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Elenco dei paesi ordinato per nome nella lingua attiva. */
export function sortedCountries(codes: string[], locale: string) {
  return codes.map((c) => [c, countryName(c, locale)] as const).sort((a, b) => a[1].localeCompare(b[1], locale));
}

/** Etichetta della fase, con lo stile del badge degli ordini. */
export function PhaseBadge({ phase }: { phase: string }) {
  const t = useT();
  const on = phase === "COMPLETED";
  const warn = ["REQUESTED", "PROPOSED", "DEPOSIT_DUE", "BALANCE_DUE", "DISPUTED", "DEPOSIT_PAID", "BALANCE_PAID"].includes(phase);
  const off = ["DECLINED", "EXPIRED", "WITHDRAWN", "REFUNDED"].includes(phase);
  return <span className={`badge ${on ? "on" : ""} ${warn ? "warn" : ""} ${off ? "off" : ""}`}>{t(`phase.${phase}`)}</span>;
}
