"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { MfaMethod, SessionUser } from "@maestranze/shared";
import { OtpInput } from "@/components/auth-shell";
import { Footer, Header } from "@/components/header";
import { api, ApiFailure, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n-client";

interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export default function AreaPage() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState<{ qrDataUrl: string; expiresAt: string } | null>(null);
  const [totp, setTotp] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, dev] = await Promise.all([
        api<{ user: SessionUser }>("/me"),
        api<{ devices: Device[] }>("/me/devices"),
      ]);
      setUser(me.user);
      setDevices(dev.devices);
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) router.replace(`/${locale}/accedi`);
    }
  }, [router, locale]);

  useEffect(() => {
    load();
  }, [load]);

  // Mentre il QR dell'app è aperto, si aggiorna l'elenco per accorgersi dell'associazione.
  useEffect(() => {
    if (!pairing) return;
    const before = devices.length;
    const id = setInterval(async () => {
      const dev = await api<{ devices: Device[] }>("/me/devices").catch(() => null);
      if (dev && dev.devices.length > before) {
        setPairing(null);
        load();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [pairing, devices.length, load]);

  // Porta in vista il QR appena compare.
  useEffect(() => {
    if (pairing || totp) document.querySelector(".qr")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pairing, totp]);

  if (!user) {
    return <div style={{ minHeight: "100svh", background: "var(--paper)" }} />;
  }

  const has = (m: MfaMethod) => user.mfaMethods.includes(m);
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <Header signedIn />
      <main style={{ background: "var(--paper)", padding: "clamp(56px, 8vw, 120px) 0" }}>
        <div className="wrap" style={{ maxWidth: 980, display: "flex", flexDirection: "column", gap: 72 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }} className="rise">
            <span className="eyebrow">{t(`area.role.${user.role}`)}</span>
            <h1 className="display h2">{t("area.welcome", { name: user.displayName })}</h1>
            <p className="lead italic" style={{ fontSize: 22 }}>
              {t(`area.next.${user.role}`)}
            </p>
          </div>

          <section className="panel">
            <span className="eyebrow plain">{t("area.security")}</span>
            <p className="small" style={{ margin: 0 }}>
              {t("area.security.body")}
            </p>

            {(["MOBILE_APP", "TOTP", "SMS"] as const).map((m) => (
              <div key={m} className="factor">
                <div>
                  <div className="name">{t(`mfa.method.${m}`)}</div>
                  <div className="desc">{m === "SMS" ? t("area.sms.body") : t(`mfa.method.${m}.body`)}</div>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <span className={`badge ${has(m) ? "on" : ""}`}>{has(m) ? t("area.active") : t("area.inactive")}</span>
                  {m === "MOBILE_APP" && (
                    <button className="link" onClick={async () => setPairing(await api("/me/devices/pairing", { method: "POST", body: {} }))}>
                      {t("area.app.cta")}
                    </button>
                  )}
                  {m === "TOTP" && !has("TOTP") && (
                    <button className="link" onClick={async () => setTotp(await api("/me/mfa/totp/setup", { method: "POST", body: {} }))}>
                      {t("area.totp.cta")}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {pairing && (
              <div className="qr rise">
                <img src={pairing.qrDataUrl} alt="QR" />
                <div className="qr-text">
                  <h3 className="display h3">{t("area.app.title")}</h3>
                  <p className="small" style={{ margin: 0 }}>
                    {t("area.app.body")}
                  </p>
                  <button className="link" style={{ alignSelf: "flex-start" }} onClick={() => setPairing(null)}>
                    {t("close")}
                  </button>
                </div>
              </div>
            )}

            {totp && (
              <form
                className="qr rise"
               
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api("/me/mfa/totp/confirm", { body: { code } });
                    setTotp(null);
                    setMsg({ kind: "ok", text: t("area.totp.done") });
                    load();
                  } catch (err) {
                    setCode("");
                    setMsg({ kind: "error", text: errorMessage(t, err) });
                  }
                }}
              >
                <img src={totp.qrDataUrl} alt="QR" />
                <div className="qr-text">
                  <h3 className="display h3">{t("area.totp.title")}</h3>
                  <p className="small" style={{ margin: 0 }}>
                    {t("area.totp.body")}
                  </p>
                  <span className="small">{t("area.totp.manual")}</span>
                  <span className="mono">{totp.secret.match(/.{1,4}/g)?.join(" ")}</span>
                  <OtpInput value={code} onChange={setCode} />
                  <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                    <button className="btn" disabled={code.length !== 6}>
                      {t("mfa.verify")}
                    </button>
                    <button type="button" className="link" onClick={() => setTotp(null)}>
                      {t("close")}
                    </button>
                  </div>
                </div>
              </form>
            )}
            {msg && <p className={`notice ${msg.kind}`}>{msg.text}</p>}
          </section>

          <section className="panel">
            <span className="eyebrow plain">{t("area.devices")}</span>
            {devices.length === 0 && <p className="small italic" style={{ fontSize: 18 }}>{t("area.devices.none")}</p>}
            {devices.map((d) => (
              <div key={d.id} className="factor">
                <div>
                  <div className="name">{d.name}</div>
                  <div className="desc">
                    {d.platform === "ios" ? "iOS" : "Android"} · {t("area.devices.since", { date: fmt(d.createdAt) })}
                  </div>
                </div>
                <button
                  className="link"
                  onClick={async () => {
                    await api(`/me/devices/${d.id}`, { method: "DELETE" });
                    load();
                  }}
                >
                  {t("area.devices.revoke")}
                </button>
              </div>
            ))}
          </section>

          <div>
            <button
              className="btn ghost"
              onClick={async () => {
                await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
                router.replace(`/${locale}`);
              }}
            >
              {t("area.logout")}
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
