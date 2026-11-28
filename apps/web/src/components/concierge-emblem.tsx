"use client";

import { useEffect, useRef, useState } from "react";

/**
 * L'emblema del Concierge: un campanello da banco in ottone, disegnato a linee sottili.
 * «ring» lo fa suonare (all'arrivo e mentre il Concierge scrive); «size» lo adatta a firma o insegna.
 */
export function ConciergeEmblem({ ring = false, size = 64, className = "" }: { ring?: boolean; size?: number; className?: string }) {
  return (
    <span className={`cg-emblem ${ring ? "ringing" : ""} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        {/* onde del suono */}
        <path className="wave w1" d="M14 22c-3 3-4 6-4 9" />
        <path className="wave w1" d="M50 22c3 3 4 6 4 9" />
        <path className="wave w2" d="M9 17c-4 4-6 9-6 14" />
        <path className="wave w2" d="M55 17c4 4 6 9 6 14" />
        <g className="bell">
          {/* pomello e stelo del pulsante */}
          <circle className="knob" cx="32" cy="15.5" r="2.4" />
          <path d="M32 18v6.5" />
          {/* cupola a mezza sfera */}
          <path d="M17 40a15 15 0 0 1 30 0" />
          <path className="shine" d="M22.5 33.5a10 10 0 0 1 6-6.5" />
        </g>
        {/* base rotonda con i piedini */}
        <path d="M12 40.5h40" />
        <path d="M13.5 40.5c0 2.6 1.2 4 3.5 4h30c2.3 0 3.5-1.4 3.5-4" />
        <path d="M19 44.5v2.5M45 44.5v2.5" />
      </svg>
    </span>
  );
}

/**
 * Il Concierge in persona: ritratto a linee d'ottone, giacca, papillon e capelli pettinati con la riga.
 * «mood»: arrive (piccolo inchino), idle (respira), writing (annuisce).
 */
export function ConciergeFigure({ mood = "idle", size = 64 }: { mood?: "arrive" | "idle" | "writing"; size?: number }) {
  return (
    <span className={`cg-figure ${mood}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <g className="body">
          {/* spalle e giacca */}
          <path d="M12 60c1.2-11 8.2-17.5 20-18.5 11.8 1 18.8 7.5 20 18.5" />
          {/* revers */}
          <path d="M26.5 42.3l5.5 9.2 5.5-9.2" />
          <path d="M24 43.5l3.2 8.5M40 43.5l-3.2 8.5" />
          {/* fazzoletto nel taschino */}
          <path className="detail" d="M41.5 51.5l3.5-1.2" />
          {/* papillon */}
          <path className="fill" d="M28.2 40.6l3.8 1.7-3.8 1.7z" />
          <path className="fill" d="M35.8 40.6l-3.8 1.7 3.8 1.7z" />
          <g className="head">
            {/* collo */}
            <path d="M28.6 33.5v4.8M35.4 33.5v4.8" />
            {/* volto */}
            <path d="M24.2 21.5c0 7.2 3.5 12.6 7.8 12.6s7.8-5.4 7.8-12.6" />
            {/* capelli con la riga */}
            <path d="M24.2 21.5c-.4-7 3.4-11.2 7.8-11.2 4.6 0 8.3 4 7.8 11.2-1.3-3.3-4.3-5.6-8.9-5.8" />
            <path className="detail" d="M27.6 13.4c1.4 1.3 2.4 2.3 3.3 2.3" />
          </g>
        </g>
      </svg>
    </span>
  );
}

/**
 * L'insegna nel cerchio: il campanello quando il Concierge attende, lui in persona quando è con il
 * cliente. All'arrivo il campanello suona, poi in dissolvenza entra il Concierge con un piccolo inchino;
 * quando se ne va, torna il campanello.
 */
export function ConciergeSigil({ present, writing = false, size = 54 }: { present: boolean; writing?: boolean; size?: number }) {
  const [shown, setShown] = useState(present);
  const [phase, setPhase] = useState<"still" | "ringing" | "arriving">("still");
  const first = useRef(true);
  useEffect(() => {
    // Al primo disegno si mostra subito lo stato giusto, senza scena.
    if (first.current) {
      first.current = false;
      setShown(present);
      return;
    }
    if (!present) {
      setShown(false);
      setPhase("still");
      return;
    }
    setPhase("ringing");
    const a = setTimeout(() => {
      setShown(true);
      setPhase("arriving");
    }, 900);
    const b = setTimeout(() => setPhase("still"), 2900);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [present]);
  return (
    <span className={`cg-sigil ${shown ? "present" : "away"}`} style={{ width: size, height: size }}>
      <span className="cg-sigil-bell">
        <ConciergeEmblem size={size} ring={phase === "ringing"} />
      </span>
      <span className="cg-sigil-figure">
        <ConciergeFigure size={size} mood={writing ? "writing" : phase === "arriving" ? "arrive" : "idle"} />
      </span>
    </span>
  );
}
