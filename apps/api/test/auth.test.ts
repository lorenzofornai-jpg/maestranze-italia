import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceMessages } from "@maestranze/shared";
import { SESSION_COOKIE } from "../src/app";
import { hotp, totpStep } from "../src/lib/crypto";
import { activeAccount, buyerPayload, fakePhone, pairPhone, setupApp, WEB, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await setupApp();
});
afterEach(async () => {
  await t.close();
});

const post = (url: string, payload: unknown, extra: Record<string, unknown> = {}) =>
  t.app.inject({ method: "POST", url, payload: payload as object, ...extra });

describe("registrazione", () => {
  it("crea un account di domanda in attesa di conferma email e invia il link", async () => {
    const p = buyerPayload();
    const res = await post("/v1/auth/register", p);
    expect(res.statusCode).toBe(202);
    const mail = t.notifier.lastEmailTo(p.email);
    expect(mail?.actionUrl).toMatch(/\/it\/attiva\?token=/);
    const { rows } = await t.pool.query("select status, phone, province from accounts where email=$1", [p.email]);
    expect(rows[0]).toEqual({ status: "PENDING_EMAIL", phone: "+393331234567", province: "FI" });
  });

  it("valida partita IVA, password e consensi con chiavi di traduzione", async () => {
    const res = await post("/v1/auth/register", buyerPayload({ vatNumber: "12345678901", password: "corta", consents: { terms: true } }));
    expect(res.statusCode).toBe(400);
    const { fields } = res.json().error;
    expect(fields.vatNumber).toBe("vat.invalid");
    expect(fields.password).toBe("password.too_short");
    expect(fields["consents.privacy"]).toBeDefined();
  });

  it("l'offerta richiede un'impresa con partita IVA e un settore dell'offerta", async () => {
    const res = await post(
      "/v1/auth/register",
      buyerPayload({ role: "MAKER", subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "RESTAURANT" }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields).toMatchObject({ sector: "sector.invalid", subjectType: "maker.company_required" });

    const ok = await post("/v1/auth/register", buyerPayload({ role: "MAKER", sector: "TAILORING", companyName: "Sartoria Napoletana" }));
    expect(ok.statusCode).toBe(202);
  });

  it("accetta una persona fisica come domanda", async () => {
    const res = await post(
      "/v1/auth/register",
      buyerPayload({ subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "PRIVATE", companyName: undefined, vatNumber: undefined }),
    );
    expect(res.statusCode).toBe(202);
  });

  it("non rivela se l'email esiste già", async () => {
    const p = buyerPayload();
    await post("/v1/auth/register", p);
    const again = await post("/v1/auth/register", { ...p, locale: "en" });
    expect(again.statusCode).toBe(202);
    expect(t.notifier.lastEmailTo(p.email)?.subject).toMatch(/tentativo di registrazione/);
  });

  it("il link di attivazione vale una volta sola e scade", async () => {
    const p = buyerPayload();
    await post("/v1/auth/register", p);
    const token = new URL(t.notifier.lastEmailTo(p.email)!.actionUrl!).searchParams.get("token");
    expect((await post("/v1/auth/activate", { token })).json()).toEqual({ status: "PENDING_MFA" });
    expect((await post("/v1/auth/activate", { token })).json().error.code).toBe("INVALID_OR_EXPIRED_TOKEN");

    const p2 = buyerPayload();
    await post("/v1/auth/register", p2);
    const token2 = new URL(t.notifier.lastEmailTo(p2.email)!.actionUrl!).searchParams.get("token");
    t.clock.offsetMs = 25 * 60 * 60 * 1000;
    expect((await post("/v1/auth/activate", { token: token2 })).statusCode).toBe(400);
  });
});

describe("accesso dal web con doppia autenticazione", () => {
  it("prima della conferma email l'accesso è negato", async () => {
    const p = buyerPayload();
    await post("/v1/auth/register", p);
    const res = await post("/v1/auth/login", { email: p.email, password: p.password });
    expect(res.json().error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("primo accesso: SMS che conferma il cellulare e attiva il profilo", async () => {
    const { user, cookie } = await activeAccount(t);
    expect(user.status).toBe("ACTIVE");
    expect(user.mfaMethods).toEqual(["SMS"]);
    const me = await t.app.inject({ method: "GET", url: "/v1/me", cookies: { [SESSION_COOKIE]: cookie } });
    expect(me.json().user.displayName).toBe("Trattoria del Borgo S.r.l.");
  });

  it("il cookie di sessione è httpOnly e SameSite=Strict", async () => {
    const p = buyerPayload();
    await post("/v1/auth/register", p);
    const token = new URL(t.notifier.lastEmailTo(p.email)!.actionUrl!).searchParams.get("token");
    await post("/v1/auth/activate", { token });
    const { loginToken } = (await post("/v1/auth/login", { email: p.email, password: p.password })).json();
    await post("/v1/auth/mfa/sms", { loginToken });
    const res = await post("/v1/auth/mfa/verify", { loginToken, method: "SMS", code: t.notifier.smss.at(-1)!.code });
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Strict");
    expect(res.json().sessionToken).toBeUndefined();
  });

  it("password errata: messaggio generico e blocco dopo 5 tentativi", async () => {
    const { payload } = await activeAccount(t);
    for (let i = 0; i < 5; i++) {
      const r = await post("/v1/auth/login", { email: payload.email, password: "Sbagliata!12345" });
      expect(r.json().error.code).toBe("INVALID_CREDENTIALS");
    }
    const locked = await post("/v1/auth/login", { email: payload.email, password: payload.password });
    expect(locked.json().error.code).toBe("ACCOUNT_LOCKED");
    t.clock.offsetMs = 16 * 60 * 1000;
    expect((await post("/v1/auth/login", { email: payload.email, password: payload.password })).statusCode).toBe(200);
  });

  it("email inesistente: stesso errore di una password sbagliata", async () => {
    const r = await post("/v1/auth/login", { email: "nessuno@nowhere.it", password: "Qualunque!1234" });
    expect(r.json().error.code).toBe("INVALID_CREDENTIALS");
  });

  it("codice SMS: tentativi limitati, reinvio dopo 30 secondi", async () => {
    const { payload } = await activeAccount(t);
    const login = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    expect(login).toMatchObject({ status: "MFA_REQUIRED", methods: ["SMS"], maskedPhone: "+39 ••• ••• 4567" });

    await post("/v1/auth/mfa/sms", { loginToken: login.loginToken });
    expect((await post("/v1/auth/mfa/sms", { loginToken: login.loginToken })).json().error.code).toBe("OTP_RATE_LIMITED");

    for (let i = 4; i >= 1; i--) {
      const r = await post("/v1/auth/mfa/verify", { loginToken: login.loginToken, method: "SMS", code: "000000" });
      expect(r.json().error).toMatchObject({ code: "INVALID_CODE", attemptsLeft: i });
    }
    await post("/v1/auth/mfa/verify", { loginToken: login.loginToken, method: "SMS", code: "000000" });
    const code = t.notifier.smss.at(-1)!.code;
    const r = await post("/v1/auth/mfa/verify", { loginToken: login.loginToken, method: "SMS", code });
    expect(r.json().error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("il codice SMS scade dopo 5 minuti", async () => {
    const { payload } = await activeAccount(t);
    const { loginToken } = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    await post("/v1/auth/mfa/sms", { loginToken });
    t.clock.offsetMs = 6 * 60 * 1000;
    const r = await post("/v1/auth/mfa/verify", { loginToken, method: "SMS", code: t.notifier.smss.at(-1)!.code });
    expect(r.json().error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("app di autenticazione TOTP: attivazione e accesso, codice non riutilizzabile", async () => {
    const { payload, cookie } = await activeAccount(t);
    const setup = (await post("/v1/me/mfa/totp/setup", {}, { cookies: { [SESSION_COOKIE]: cookie } })).json();
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Maestranze%20Italia/);
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const confirm = await post("/v1/me/mfa/totp/confirm", { code: hotp(setup.secret, totpStep()) }, { cookies: { [SESSION_COOKIE]: cookie } });
    expect(confirm.json().methods).toEqual(["TOTP", "SMS"]);

    const login = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    expect(login.methods).toEqual(["TOTP", "SMS"]);
    // Lo stesso codice usato per la conferma non vale per l'accesso.
    const reused = await post("/v1/auth/mfa/verify", { loginToken: login.loginToken, method: "TOTP", code: hotp(setup.secret, totpStep()) });
    expect(reused.json().error.code).toBe("INVALID_CODE");
    t.clock.offsetMs = 30_000;
    const ok = await post("/v1/auth/mfa/verify", {
      loginToken: login.loginToken,
      method: "TOTP",
      code: hotp(setup.secret, totpStep(Date.now() + 30_000)),
    });
    expect(ok.statusCode).toBe(200);
  });

  it("rifiuta richieste da un'origine diversa dal sito (CSRF)", async () => {
    const r = await post("/v1/auth/login", { email: "a@b.it", password: "x" }, { headers: { origin: "https://evil.example" } });
    expect(r.statusCode).toBe(403);
    const ok = await post("/v1/auth/login", { email: "a@b.it", password: "x" }, { headers: { origin: WEB } });
    expect(ok.statusCode).toBe(401);
  });

  it("la sessione scade dopo 15 minuti di inattività", async () => {
    const { cookie } = await activeAccount(t);
    t.clock.offsetMs = 10 * 60 * 1000;
    expect((await t.app.inject({ method: "GET", url: "/v1/me", cookies: { [SESSION_COOKIE]: cookie } })).statusCode).toBe(200);
    t.clock.offsetMs = 26 * 60 * 1000;
    expect((await t.app.inject({ method: "GET", url: "/v1/me", cookies: { [SESSION_COOKIE]: cookie } })).statusCode).toBe(401);
  });
});

describe("app mobile come chiave di sicurezza", () => {
  it("associazione tramite QR code dal sito", async () => {
    const { cookie, payload } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);
    expect(phone.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.notifier.lastEmailTo(payload.email)?.subject).toMatch(/nuovo dispositivo/);
    const devices = await t.app.inject({ method: "GET", url: "/v1/me/devices", cookies: { [SESSION_COOKIE]: cookie } });
    expect(devices.json().devices[0].name).toBe("iPhone di Giulia");
  });

  it("il codice del QR code vale una volta sola e la chiave deve firmare la richiesta", async () => {
    const { cookie } = await activeAccount(t);
    const { code } = (await post("/v1/me/devices/pairing", {}, { cookies: { [SESSION_COOKIE]: cookie } })).json();
    const phone = fakePhone();
    const other = fakePhone();
    const forged = await post("/v1/device/enroll", {
      pairingCode: code,
      publicKey: phone.publicKey,
      signature: other.sign(deviceMessages.enroll(code, phone.publicKey)),
      name: "x",
      platform: "ios",
    });
    expect(forged.json().error.code).toBe("INVALID_DEVICE_SIGNATURE");
    const reuse = await post("/v1/device/enroll", {
      pairingCode: code,
      publicKey: phone.publicKey,
      signature: phone.sign(deviceMessages.enroll(code, phone.publicKey)),
      name: "x",
      platform: "ios",
    });
    expect(reuse.json().error.code).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("accesso web approvato dall'app con notifica push", async () => {
    const { cookie, payload } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);

    const login = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    expect(login.methods).toEqual(["MOBILE_APP", "SMS"]);
    expect((await post("/v1/auth/mfa/push", { loginToken: login.loginToken })).json()).toEqual({ status: "PENDING", devices: 1 });
    expect(t.notifier.pushes.at(-1)).toMatchObject({ to: "ExponentPushToken[test]", title: "Richiesta di accesso" });
    expect((await post("/v1/auth/mfa/push/poll", { loginToken: login.loginToken })).json().status).toBe("PENDING");

    const ts = Date.now();
    const pending = await post("/v1/device/approvals", { deviceId: phone.deviceId, timestamp: ts, signature: phone.sign(deviceMessages.pending(phone.deviceId, ts)) });
    const [approval] = pending.json().approvals;
    expect(approval).toMatchObject({ purpose: "LOGIN", channel: "WEB" });

    const respond = await post("/v1/device/approvals/respond", {
      deviceId: phone.deviceId,
      challengeId: approval.id,
      decision: "APPROVE",
      signature: phone.sign(deviceMessages.respond(approval.id, approval.nonce, "APPROVE")),
    });
    expect(respond.json().status).toBe("APPROVED");

    const done = await post("/v1/auth/mfa/push/poll", { loginToken: login.loginToken });
    expect(done.json().status).toBe("APPROVED");
    expect(done.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined();
    // La sessione si consegna una volta sola.
    expect((await post("/v1/auth/mfa/push/poll", { loginToken: login.loginToken })).json().status).toBe("EXPIRED");
  });

  it("rifiuto dall'app: il browser riceve DENIED", async () => {
    const { cookie, payload } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);
    const { loginToken } = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    await post("/v1/auth/mfa/push", { loginToken });
    const ts = Date.now();
    const [a] = (await post("/v1/device/approvals", { deviceId: phone.deviceId, timestamp: ts, signature: phone.sign(deviceMessages.pending(phone.deviceId, ts)) })).json().approvals;
    await post("/v1/device/approvals/respond", {
      deviceId: phone.deviceId,
      challengeId: a.id,
      decision: "DENY",
      signature: phone.sign(deviceMessages.respond(a.id, a.nonce, "DENY")),
    });
    expect((await post("/v1/auth/mfa/push/poll", { loginToken })).json().status).toBe("DENIED");
  });

  it("una firma per APPROVE non può essere usata per un'altra sfida", async () => {
    const { cookie, payload } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);
    const { loginToken } = (await post("/v1/auth/login", { email: payload.email, password: payload.password })).json();
    await post("/v1/auth/mfa/push", { loginToken });
    const ts = Date.now();
    const [a] = (await post("/v1/device/approvals", { deviceId: phone.deviceId, timestamp: ts, signature: phone.sign(deviceMessages.pending(phone.deviceId, ts)) })).json().approvals;
    const bad = await post("/v1/device/approvals/respond", {
      deviceId: phone.deviceId,
      challengeId: a.id,
      decision: "APPROVE",
      signature: phone.sign(deviceMessages.respond(a.id, "altro-nonce", "APPROVE")),
    });
    expect(bad.json().error.code).toBe("INVALID_DEVICE_SIGNATURE");
  });

  it("accesso diretto dall'app con la chiave del dispositivo, nonce monouso", async () => {
    const { cookie } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);
    const { nonce } = (await post("/v1/device/nonce", { deviceId: phone.deviceId })).json();
    const signature = phone.sign(deviceMessages.login(phone.deviceId, nonce));
    const res = await post("/v1/device/login", { deviceId: phone.deviceId, nonce, signature });
    expect(res.statusCode).toBe(200);
    const { sessionToken } = res.json();
    expect(sessionToken).toBeTruthy();
    const me = await t.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${sessionToken}` } });
    expect(me.json().user.mfaMethods).toContain("MOBILE_APP");
    // L'app sbloccata vede le richieste in attesa con la sessione; dal web la stessa rotta è vietata.
    const apprs = await t.app.inject({ method: "GET", url: "/v1/me/approvals", headers: { authorization: `Bearer ${sessionToken}` } });
    expect(apprs.json()).toEqual({ approvals: [] });
    expect((await t.app.inject({ method: "GET", url: "/v1/me/approvals", cookies: { [SESSION_COOKIE]: cookie } })).statusCode).toBe(403);
    expect((await post("/v1/device/login", { deviceId: phone.deviceId, nonce, signature })).statusCode).toBe(401);
  });

  it("primo accesso direttamente dall'app: password + SMS, poi associazione del telefono", async () => {
    const { payload } = await activeAccount(t);
    const mobile = { "x-client": "mobile" };
    const { loginToken } = (await post("/v1/auth/login", { email: payload.email, password: payload.password }, { headers: mobile })).json();
    await post("/v1/auth/mfa/sms", { loginToken });
    const v = await post("/v1/auth/mfa/verify", { loginToken, method: "SMS", code: t.notifier.smss.at(-1)!.code }, { headers: mobile });
    const { sessionToken } = v.json();
    expect(sessionToken).toBeTruthy();

    const phone = fakePhone();
    const enroll = await post(
      "/v1/device/enroll",
      { publicKey: phone.publicKey, signature: phone.sign(deviceMessages.enroll("session", phone.publicKey)), name: "Pixel", platform: "android" },
      { headers: { ...mobile, authorization: `Bearer ${sessionToken}` } },
    );
    expect(enroll.statusCode).toBe(200);
    expect(enroll.json().user.mfaMethods).toContain("MOBILE_APP");
  });

  it("revocando il dispositivo si chiudono le sue sessioni e non firma più", async () => {
    const { cookie } = await activeAccount(t);
    const phone = await pairPhone(t, cookie);
    const { nonce } = (await post("/v1/device/nonce", { deviceId: phone.deviceId })).json();
    const { sessionToken } = (await post("/v1/device/login", { deviceId: phone.deviceId, nonce, signature: phone.sign(deviceMessages.login(phone.deviceId, nonce)) })).json();

    await t.app.inject({ method: "DELETE", url: `/v1/me/devices/${phone.deviceId}`, cookies: { [SESSION_COOKIE]: cookie } });
    expect((await t.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(401);
    expect((await post("/v1/device/nonce", { deviceId: phone.deviceId })).json().error.code).toBe("DEVICE_NOT_ACTIVE");
  });
});

describe("recupero password", () => {
  it("nuova password via email, chiude tutte le sessioni", async () => {
    const { payload, cookie } = await activeAccount(t);
    await post("/v1/auth/password/forgot", { email: payload.email });
    const token = new URL(t.notifier.lastEmailTo(payload.email)!.actionUrl!).searchParams.get("token");
    expect((await post("/v1/auth/password/reset", { token, password: "Pecorino#Romano99" })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: "/v1/me", cookies: { [SESSION_COOKIE]: cookie } })).statusCode).toBe(401);
    expect((await post("/v1/auth/login", { email: payload.email, password: "Pecorino#Romano99" })).json().status).toBe("MFA_REQUIRED");
  });
});
