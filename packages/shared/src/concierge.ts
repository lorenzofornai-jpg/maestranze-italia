import type { Discipline, I18nText } from "./catalog";
import type { TailoringBrief } from "./commissions";

// =============================================================================================
// Il Concierge: l'assistente del portale (LLM) che accompagna il cliente verso le botteghe giuste
// =============================================================================================

/** Battute per conversazione e lunghezza massima di un messaggio. */
export const CONCIERGE_MAX_TURNS = 40;
export const CONCIERGE_MAX_CHARS = 2000;

export interface ConciergeMaisonCard {
  slug: string;
  name: string;
  discipline: Discipline;
  city: string;
  region: string;
  tagline: I18nText;
  coverImage: string | null;
  acceptsCommissions: boolean;
}

/** Bozza di brief su misura preparata dal Concierge: il cliente la rivede e la invia lui. */
export interface ConciergeDraft {
  id: string;
  maison: { slug: string; name: string };
  brief: Partial<TailoringBrief>;
  language?: string;
}

/** Ciò che la pagina del Concierge mostra, nell'ordine. */
export type ConciergeItem =
  | { kind: "guest"; text: string }
  | { kind: "concierge"; text: string }
  | { kind: "maisons"; maisons: ConciergeMaisonCard[] }
  | { kind: "draft"; draft: ConciergeDraft };

/** Eventi trasmessi riga per riga (NDJSON) mentre il Concierge risponde. */
export type ConciergeEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "item"; item: ConciergeItem }
  | { type: "done" }
  | { type: "error"; code: string };
