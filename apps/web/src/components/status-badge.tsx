"use client";

import type { OrderStatus } from "@maestranze/shared";
import { useT } from "@/lib/i18n-client";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const t = useT();
  const on = status === "COMPLETED" || status === "DELIVERED";
  const warn = status === "DISPUTED" || status === "AWAITING_AUTHORIZATION";
  return <span className={`badge ${on ? "on" : ""} ${warn ? "warn" : ""}`}>{t(`status.${status}`)}</span>;
}

