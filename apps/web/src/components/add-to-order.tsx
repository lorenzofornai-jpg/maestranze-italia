"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicProduct } from "@maestranze/shared";
import { useCart } from "@/lib/cart";
import { useLocale, useT } from "@/lib/i18n-client";

export function AddToOrder({ maison, product }: { maison: { id: string; slug: string; name: string }; product: PublicProduct }) {
  const t = useT();
  const locale = useLocale();
  const { add, cart, clear } = useCart();
  const [qty, setQty] = useState(product.minQty);
  const [state, setState] = useState<"idle" | "added" | "other-maison">("idle");

  const doAdd = () =>
    setState(
      add(maison, {
        productId: product.id,
        name: product.name,
        unitCents: product.b2bPriceCents ?? product.priceCents,
        qty,
        minQty: product.minQty,
        image: product.image,
      }),
    );

  return (
    <div className="add-to-order">
      <div className="stepper" role="group" aria-label="Quantità">
        <button type="button" onClick={() => setQty((q) => Math.max(product.minQty, q - 1))} aria-label="−">
          −
        </button>
        <span>{qty}</span>
        <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="+">
          +
        </button>
      </div>
      <button type="button" className="btn ghost" onClick={doAdd}>
        {t("maison.add")}
      </button>
      {state === "added" && (
        <Link href={`/${locale}/ordine`} className="link added-note">
          {t("cart.added")}
        </Link>
      )}
      {state === "other-maison" && cart && (
        <p className="small added-note">
          {t("cart.other_maison", { name: cart.maison.name })}{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              clear();
              doAdd();
            }}
          >
            {t("cart.replace")}
          </button>
        </p>
      )}
    </div>
  );
}
