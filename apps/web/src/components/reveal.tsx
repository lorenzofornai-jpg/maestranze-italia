"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Fa emergere il contenuto quando entra nello schermo, con un ritardo opzionale. */
export function Reveal({ children, delay = 0, as: Tag = "div", className = "" }: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section" | "li" | "article";
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      // Basta che l'elemento entri nello schermo (anche se molto alto, come l'elenco delle regioni).
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    // Rete di sicurezza: se il browser non segnala l'ingresso (alcuni Safari), si controlla durante lo scorrimento.
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) {
        el.classList.add("in");
        window.removeEventListener("scroll", check);
      }
    };
    window.addEventListener("scroll", check, { passive: true });
    check();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", check);
    };
  }, []);
  return (
    // @ts-expect-error: ref generico su tag dinamico
    <Tag ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
