import { describe, expect, it } from "vitest";
import { ExpoPush, TwilioSms } from "../src/lib/channels";
import { loadConfig } from "../src/config";

/** fetch finto che registra le richieste e risponde come il fornitore. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("SMS con Twilio", () => {
  it("invia con autenticazione Basic e Messaging Service", async () => {
    const f = fakeFetch(201, { sid: "SM123" });
    const sms = new TwilioSms({ accountSid: "AC1", authToken: "secret", messagingServiceSid: "MG9" }, () => {}, f.impl);
    await sms.send({ to: "+393331234567", text: "Codice 123456" });
    expect(f.calls[0]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
    const body = f.calls[0]!.init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ To: "+393331234567", Body: "Codice 123456", MessagingServiceSid: "MG9" });
  });

  it("un rifiuto diventa un errore, senza scrivere il numero nel log", async () => {
    const f = fakeFetch(400, { code: 21211, message: "Invalid 'To' Phone Number" });
    const logs: string[] = [];
    const sms = new TwilioSms({ accountSid: "AC1", authToken: "x", from: "+15005550006" }, (m) => logs.push(m), f.impl);
    await expect(sms.send({ to: "+393331234567", text: "x" })).rejects.toThrow("SMS_DELIVERY_FAILED");
    expect(logs.join(" ")).not.toContain("3331234567");
  });
});

describe("push con Expo", () => {
  it("rimuove i token non più registrati", async () => {
    const f = fakeFetch(200, { data: [{ status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }] });
    const removed: string[] = [];
    const push = new ExpoPush({ onInvalidToken: async (t) => void removed.push(t) }, () => {}, f.impl);
    await push.send([{ to: "ExponentPushToken[old]", title: "t", body: "b", data: {} }]);
    expect(removed).toEqual(["ExponentPushToken[old]"]);
    expect(JSON.parse(f.calls[0]!.init.body as string)[0]).toMatchObject({ priority: "high", channelId: "approvals" });
  });
});

describe("configurazione", () => {
  const base = { DATABASE_URL: "postgres://x@localhost/x", DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") };
  it("in produzione rifiuta SMS sul log e push non reali", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/fornitore SMS reale/);
  });
  it("Twilio richiede le credenziali", () => {
    expect(() => loadConfig({ ...base, SMS_PROVIDER: "twilio" })).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(loadConfig({ ...base, SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+1" }).SMS_PROVIDER).toBe("twilio");
  });
});
