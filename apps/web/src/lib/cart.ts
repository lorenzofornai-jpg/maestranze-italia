"use client";

import { useCallback, useEffect, useState } from "react";
import type { I18nText } from "@maestranze/shared";

/**
 * Carrello: un ordine riguarda una sola Maison (spedizione e pagamento sono per Maison).
 * Vive nel browser; il prezzo vero lo ricalcola sempre il server al momento dell'ordine.
 */
export interface CartLine {
  productId: string;
  name: I18nText;
  unitCents: number;
  qty: number;
  minQty: number;
  image: string | null;
}
export interface Cart {
  maison: { id: string; slug: string; name: string };
  lines: CartLine[];
}

const KEY = "mi.cart";
const EVENT = "mi-cart";

export function readCart(): Cart | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Cart) : null;
  } catch {
    return null;
  }
}

export function writeCart(cart: Cart | null) {
  try {
    if (cart && cart.lines.length) localStorage.setItem(KEY, JSON.stringify(cart));
    else localStorage.removeItem(KEY);
  } catch {
    /* archiviazione non disponibile: il carrello resta in memoria per questa pagina */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useCart() {
  const [cart, setCart] = useState<Cart | null>(null);
  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((maison: Cart["maison"], line: CartLine): "added" | "other-maison" => {
    const current = readCart();
    if (current && current.maison.id !== maison.id) return "other-maison";
    const lines = current?.lines.slice() ?? [];
    const i = lines.findIndex((l) => l.productId === line.productId);
    if (i >= 0) lines[i] = { ...lines[i]!, qty: lines[i]!.qty + line.qty };
    else lines.push(line);
    writeCart({ maison, lines });
    return "added";
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    const current = readCart();
    if (!current) return;
    writeCart({
      ...current,
      lines: current.lines.map((l) => (l.productId === productId ? { ...l, qty: Math.max(l.minQty, qty) } : l)),
    });
  }, []);

  const remove = useCallback((productId: string) => {
    const current = readCart();
    if (!current) return;
    writeCart({ ...current, lines: current.lines.filter((l) => l.productId !== productId) });
  }, []);

  const clear = useCallback(() => writeCart(null), []);
  const count = cart?.lines.reduce((n, l) => n + l.qty, 0) ?? 0;
  return { cart, add, setQty, remove, clear, count };
}
