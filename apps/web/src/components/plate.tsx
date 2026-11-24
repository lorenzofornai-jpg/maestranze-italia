/**
 * Tavola d'apertura: un arco con un paesaggio inciso a tratteggio, come una calcografia.
 * Nessuna fotografia da cartolina: linee, materia, luce.
 */
export function HeroPlate() {
  return (
    <svg viewBox="0 0 400 520" className="plate-svg" role="img" aria-label="Arco con paesaggio inciso">
      <defs>
        <clipPath id="arch">
          <path d="M0 520V200a200 200 0 0 1 400 0v320z" />
        </clipPath>
        <pattern id="etch" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 2h4" stroke="#f4eee2" strokeWidth=".45" />
        </pattern>
        <pattern id="etch-fine" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <path d="M0 1.5h3" stroke="#f4eee2" strokeWidth=".35" />
        </pattern>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1915" />
          <stop offset=".55" stopColor="#3a2a21" />
          <stop offset="1" stopColor="#6e3b27" />
        </linearGradient>
        <radialGradient id="sun" cx=".45" cy=".4" r=".7">
          <stop offset="0" stopColor="#d89a73" />
          <stop offset=".6" stopColor="#b25a38" />
          <stop offset="1" stopColor="#93432a" />
        </radialGradient>
      </defs>

      <g clipPath="url(#arch)">
        <rect width="400" height="520" fill="url(#sky)" />
        <g className="plate-sun">
          <circle cx="262" cy="238" r="74" fill="url(#sun)" />
          <circle cx="262" cy="238" r="74" fill="url(#etch-fine)" opacity=".18" />
        </g>
        {/* Colline: piene per coprire il sole, poi tratteggiate */}
        <path d="M-10 330C60 300 120 286 190 300s150 40 230 16V540H-10z" fill="#2c231c" />
        <path d="M-10 330C60 300 120 286 190 300s150 40 230 16V540H-10z" fill="url(#etch)" opacity=".32" />
        <path d="M-10 380c80-36 150-40 220-22s120 34 200 6V540H-10z" fill="#221c17" />
        <path d="M-10 380c80-36 150-40 220-22s120 34 200 6V540H-10z" fill="url(#etch)" opacity=".22" />
        <path d="M-10 440c70-22 130-26 200-10s140 22 220-4V540H-10z" fill="#171410" />
        <path d="M-10 440c70-22 130-26 200-10s140 22 220-4V540H-10z" fill="url(#etch-fine)" opacity=".14" />
        {/* Filari incisi sul primo piano */}
        {Array.from({ length: 9 }).map((_, i) => (
          <path
            key={i}
            d={`M${-20 + i * 52} 540 Q ${120 + i * 18} 470 ${200 + i * 6} 452`}
            stroke="#f4eee2"
            strokeWidth=".4"
            opacity=".22"
            fill="none"
          />
        ))}
        {/* Filo che scende dall'alto: la mano del sarto */}
        <path d="M118 0v196" stroke="#a68a5b" strokeWidth=".6" />
        <path d="M118 196c0 10-4 16-4 24" stroke="#a68a5b" strokeWidth=".6" fill="none" />
        <ellipse cx="113.5" cy="226" rx="1.4" ry="6.5" fill="none" stroke="#a68a5b" strokeWidth=".6" />
      </g>

      {/* Cornice */}
      <path d="M0.5 519.5V200a199.5 199.5 0 0 1 399 0v319.5" fill="none" stroke="#a68a5b" strokeWidth=".8" />
    </svg>
  );
}

/** Campioni di materia per le cinque Arti, in puro CSS (vedi .swatch-*). */
export const ARTS = ["food", "beverage", "tailoring", "sport", "crafts"] as const;
