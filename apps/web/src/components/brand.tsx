import Link from "next/link";
import type { Locale } from "@/lib/i18n";

/** Marchio: parola in maiuscoletto spaziato, filetto e «Italia» in corsivo. */
export function Wordmark({ locale, tone = "ink", size = "md" }: { locale: Locale; tone?: "ink" | "paper"; size?: "md" | "lg" }) {
  return (
    <Link href={`/${locale}`} className={`wordmark ${tone} ${size}`} aria-label="Maestranze Italia">
      <span className="wm-main">Maestranze</span>
      <span className="wm-sub">
        <i />
        Italia
        <i />
      </span>
    </Link>
  );
}

/** Monogramma «M» dentro un arco: firma visiva per sigilli, favicon, schermate dell'app. */
export function Monogram({ size = 56, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none" aria-hidden="true">
      <path d="M4 98V40a36 36 0 0 1 72 0v58" stroke={color} strokeWidth="1" />
      <path d="M10 98V41a30 30 0 0 1 60 0v57" stroke={color} strokeWidth=".5" opacity=".6" />
      <text
        x="40"
        y="78"
        textAnchor="middle"
        fontFamily="Cormorant Garamond, Garamond, serif"
        fontSize="46"
        fontWeight="300"
        fill={color}
      >
        M
      </text>
    </svg>
  );
}
