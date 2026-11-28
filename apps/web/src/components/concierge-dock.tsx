"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConciergeSigil } from "@/components/concierge-emblem";
import { ConciergeRoom } from "@/components/concierge-room";
import { useConciergePresence } from "@/lib/concierge-presence";
import { useLocale, useT } from "@/lib/i18n-client";

/**
 * Il cerchio del Concierge, in basso a sinistra su tutte le pagine: il campanello quando attende,
 * lui in persona quando è con il cliente. Toccandolo, la conversazione si apre in un pannello di lato,
 * così si continua a parlargli mentre si visitano le Maison.
 */
export function ConciergeDock() {
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname() ?? "";
  const { active } = useConciergePresence();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/v1/concierge/status")
      .then((r) => r.json())
      .then((r) => setEnabled(!!r.enabled))
      .catch(() => {});
  }, []);
  // Se il Concierge se ne va, il pannello si chiude.
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  // Nel salotto il Concierge è già lì; nelle pagine di accesso non serve.
  if (!enabled || /^\/(it|en)\/(concierge|accedi|registrati|attiva|nuova-password|password-dimenticata)(\/|$)/.test(pathname)) return null;

  const label = active ? t("cg.dock.open") : t("cg.dock.call");
  return (
    <>
      {active ? (
        <button type="button" className={`cg-dock ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={label}>
          <ConciergeSigil present size={40} />
          <span className="cg-dock-label">{label}</span>
        </button>
      ) : (
        <Link href={`/${locale}/concierge`} className="cg-dock" aria-label={label}>
          <ConciergeSigil present={false} size={40} />
          <span className="cg-dock-label">{label}</span>
        </Link>
      )}
      {active && (
        <div className={`cg-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
          <div className="cg-drawer-backdrop" onClick={() => setOpen(false)} />
          <aside className="cg-drawer-panel concierge" role="dialog" aria-label={t("cg.name")}>
            {open && <ConciergeRoom compact onClose={() => setOpen(false)} />}
          </aside>
        </div>
      )}
    </>
  );
}
