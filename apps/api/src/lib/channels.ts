/**
 * Canali di consegna: SMS e notifiche push. Ogni fornitore è un adattatore dietro la stessa interfaccia;
 * `fetch` è iniettabile per poterli provare senza rete.
 */
import type { PushMessage, SmsMessage } from "./notifications";

type Fetch = typeof fetch;
type Log = (msg: string) => void;

export interface SmsSender {
  send(msg: SmsMessage): Promise<void>;
}

export interface PushSender {
  send(msgs: PushMessage[]): Promise<void>;
}

// --- SMS -----------------------------------------------------------------------------------------

/** Solo sviluppo: stampa il messaggio nel log (codici compresi). Rifiutato in produzione dalla configurazione. */
export class ConsoleSms implements SmsSender {
  constructor(private log: Log) {}
  async send(msg: SmsMessage) {
    this.log(`[sms] ${msg.to}: ${msg.text}`);
  }
}

/**
 * Twilio Programmable Messaging. Mittente: un numero (`from`) oppure un Messaging Service, che in Italia
 * permette un mittente alfanumerico registrato (es. «Maestranze»).
 */
export class TwilioSms implements SmsSender {
  constructor(
    private opts: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string },
    private log: Log,
    private fetchImpl: Fetch = fetch,
  ) {}

  async send(msg: SmsMessage) {
    const body = new URLSearchParams({ To: msg.to, Body: msg.text });
    if (this.opts.messagingServiceSid) body.set("MessagingServiceSid", this.opts.messagingServiceSid);
    else if (this.opts.from) body.set("From", this.opts.from);
    const auth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      // Il numero di telefono non finisce nel log: basta l'esito.
      this.log(`[sms] Twilio ha rifiutato l'invio: ${res.status} ${err.code ?? ""} ${err.message ?? ""}`);
      throw new Error("SMS_DELIVERY_FAILED");
    }
  }
}

// --- Push ----------------------------------------------------------------------------------------

export class ConsolePush implements PushSender {
  constructor(private log: Log) {}
  async send(msgs: PushMessage[]) {
    for (const m of msgs) this.log(`[push] ${m.to}: ${m.title} — ${m.body}`);
  }
}

/**
 * Expo Push Service (inoltra ad APNs e FCM). Se un token non è più valido (app disinstallata),
 * `onInvalidToken` lo rimuove dal dispositivo.
 */
export class ExpoPush implements PushSender {
  constructor(
    private opts: { accessToken?: string; onInvalidToken?: (token: string) => Promise<void> },
    private log: Log,
    private fetchImpl: Fetch = fetch,
  ) {}

  async send(msgs: PushMessage[]) {
    if (msgs.length === 0) return;
    const res = await this.fetchImpl("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}),
      },
      body: JSON.stringify(
        msgs.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, priority: "high", sound: "default", channelId: "approvals" })),
      ),
    }).catch((err: Error) => {
      this.log(`[push] Expo non raggiungibile: ${err.message}`);
      return null;
    });
    if (!res) return;
    const json = (await res.json().catch(() => ({}))) as {
      data?: { status: string; message?: string; details?: { error?: string } }[];
      errors?: { message: string }[];
    };
    if (!res.ok || json.errors) {
      this.log(`[push] Expo ha rifiutato la richiesta: ${res.status} ${json.errors?.map((e) => e.message).join("; ") ?? ""}`);
      return;
    }
    for (const [i, ticket] of (json.data ?? []).entries()) {
      if (ticket.status !== "error") continue;
      if (ticket.details?.error === "DeviceNotRegistered" && msgs[i]) await this.opts.onInvalidToken?.(msgs[i]!.to);
      else this.log(`[push] consegna non riuscita: ${ticket.message ?? ticket.details?.error ?? "errore"}`);
    }
  }
}
