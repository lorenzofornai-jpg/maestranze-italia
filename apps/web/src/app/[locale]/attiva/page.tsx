"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { api } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

function Activate() {
  const locale = useLocale();
  const t = useT();
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "ok" | "ko">("loading");
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (!token) return setState("ko");
    api("/auth/activate", { body: { token } })
      .then(() => setState("ok"))
      .catch(() => setState("ko"));
  }, [token]);

  return (
    <AuthShell>
      <div className="auth-body">
        <span className="eyebrow">{t("reg.eyebrow")}</span>
        {state === "loading" && <h1 className="display h2 italic">{t("activate.loading")}</h1>}
        {state === "ok" && (
          <>
            <h1 className="display h2">{t("activate.ok.title")}</h1>
            <p className="lead">{t("activate.ok.body")}</p>
            <div>
              <Link href={`/${locale}/accedi`} className="btn">
                {t("activate.ok.cta")} <span className="arrow" />
              </Link>
            </div>
          </>
        )}
        {state === "ko" && (
          <>
            <h1 className="display h2">{t("activate.ko.title")}</h1>
            <p className="lead">{t("activate.ko.body")}</p>
            <div>
              <Link href={`/${locale}/accedi`} className="btn ghost">
                {t("nav.signin")} <span className="arrow" />
              </Link>
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Activate />
    </Suspense>
  );
}
