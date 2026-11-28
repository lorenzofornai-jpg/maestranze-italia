"use client";

import { useEffect, useState } from "react";

/**
 * Presenza del Concierge: resta con il cliente su tutte le pagine finché la conversazione è viva.
 * Se ne va quando il cliente lo congeda o dopo 30 minuti senza parlargli; allora torna il campanello.
 */
const SESSION = "mi_concierge";
const UNTIL = "mi_concierge_until";
const EVENT = "mi-concierge";
export const CONCIERGE_STAY_MS = 30 * 60 * 1000;

export interface Presence {
  sessionId: string | null;
  active: boolean;
}

function read(): Presence {
  try {
    const sessionId = localStorage.getItem(SESSION);
    const until = Number(localStorage.getItem(UNTIL) ?? 0);
    return { sessionId, active: !!sessionId && until > Date.now() };
  } catch {
    return { sessionId: null, active: false };
  }
}

/** Il cliente ha parlato con il Concierge: resta per altri 30 minuti. */
export function conciergeArrive(sessionId: string) {
  try {
    localStorage.setItem(SESSION, sessionId);
    localStorage.setItem(UNTIL, String(Date.now() + CONCIERGE_STAY_MS));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** Il cliente lo congeda: la prossima volta si ricomincia da capo. */
export function conciergeLeave() {
  try {
    localStorage.removeItem(SESSION);
    localStorage.removeItem(UNTIL);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function readConciergeSession() {
  return read().sessionId;
}

export function useConciergePresence(): Presence {
  const [p, setP] = useState<Presence>({ sessionId: null, active: false });
  useEffect(() => {
    const update = () => setP(read());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    const tick = setInterval(update, 30_000);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
      clearInterval(tick);
    };
  }, []);
  return p;
}

/** La conversazione da riprendere, solo se il Concierge è ancora con il cliente. */
export function activeConciergeSession() {
  const p = read();
  return p.active ? p.sessionId : null;
}
