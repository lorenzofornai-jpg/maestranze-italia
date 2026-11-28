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
