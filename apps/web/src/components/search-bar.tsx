"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Interpretation } from "@maestranze/shared";
import { api } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

/**
 * Ricerca in linguaggio naturale: la frase va all'API, che la trasforma in filtri (con l'LLM se
 * configurato, altrimenti con le regole). La pagina dei risultati mostra come è stata capita.
 */
export function SearchBar({ initial = "" }: { initial?: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const query = text.trim();
    if (query.length < 2) return;
    setBusy(true);
    const params = new URLSearchParams();
    try {
      const r = await api<Interpretation>("/search/interpret", { body: { query } });
      for (const [k, v] of Object.entries(r.filters)) if (v != null && v !== "") params.set(k, String(v));
      params.set("frase", query);
      params.set("letto", r.explanation[locale] || "");
      if (r.source === "llm") params.set("llm", "1");
      if (r.professional) params.set("pro", "1");
    } catch {
      params.set("q", query);
    }
    router.push(`/${locale}/esplora?${params.toString()}`);
    setBusy(false);
  };

  return (
    <form className="search-bar" onSubmit={submit} role="search">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("explore.placeholder")}
        aria-label={t("explore.search")}
        maxLength={300}
      />
      <button className="btn" disabled={busy}>
        {t("explore.search")} <span className="arrow" />
      </button>
    </form>
  );
}
