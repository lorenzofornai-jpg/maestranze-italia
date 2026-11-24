import nodemailer from "nodemailer";
import type { PushSender, SmsSender } from "./channels";
import type { Locale } from "@maestranze/shared";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Link d'azione contenuto nel messaggio (comodo per test e log di sviluppo). */
  actionUrl?: string;
}

export interface SmsMessage {
  to: string;
  text: string;
  /** Codice contenuto, solo per i test. */
  code?: string;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface Notifier {
  email(msg: EmailMessage): Promise<void>;
  sms(msg: SmsMessage): Promise<void>;
  push(msg: PushMessage): Promise<void>;
}

/** Raccoglie i messaggi in memoria: per i test automatici. */
export class MemoryNotifier implements Notifier {
  emails: EmailMessage[] = [];
  smss: SmsMessage[] = [];
  pushes: PushMessage[] = [];
  async email(msg: EmailMessage) {
    this.emails.push(msg);
  }
  async sms(msg: SmsMessage) {
    this.smss.push(msg);
  }
  async push(msg: PushMessage) {
    this.pushes.push(msg);
  }
  lastEmailTo(to: string) {
    return this.emails.filter((m) => m.to === to).at(-1);
  }
  lastSmsTo(to: string) {
    return this.smss.filter((m) => m.to === to).at(-1);
  }
}

/** Notifiche reali: email via SMTP (Mailpit in sviluppo), SMS e push tramite gli adattatori configurati. */
export class LiveNotifier implements Notifier {
  private transport;
  constructor(
    smtpUrl: string,
    private from: string,
    private smsSender: SmsSender,
    private pushSender: PushSender,
    private log: (msg: string) => void,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async email(msg: EmailMessage) {
    try {
      await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      this.log(`[email] invio non riuscito: ${(err as Error).message}`);
    }
    if (msg.actionUrl && process.env.NODE_ENV !== "production") this.log(`[email] ${msg.to} → ${msg.actionUrl}`);
  }

  async sms(msg: SmsMessage) {
    await this.smsSender.send(msg);
  }

  async push(msg: PushMessage) {
    await this.pushSender.send([msg]);
  }
}

// --- Testi dei messaggi, in italiano e in inglese ----------------------------------------------

const T = {
  it: {
    activationSubject: "Benvenuto in Maestranze Italia — conferma il tuo indirizzo",
    activationTitle: "Il saper fare italiano ti aspetta",
    activationBody:
      "Grazie per aver richiesto l'accesso a Maestranze Italia. Per attivare il tuo profilo conferma questo indirizzo email entro 24 ore.",
    activationCta: "Attiva il profilo",
    existsSubject: "Maestranze Italia — tentativo di registrazione",
    existsBody:
      "Qualcuno ha provato a registrarsi con questo indirizzo, che ha già un profilo. Se sei stato tu, accedi o recupera la password. Altrimenti ignora questo messaggio.",
    existsCta: "Accedi",
    resetSubject: "Maestranze Italia — nuova password",
    resetBody: "Abbiamo ricevuto una richiesta di nuova password. Il link vale 30 minuti. Se non l'hai chiesta tu, ignora questo messaggio.",
    resetCta: "Imposta la nuova password",
    newDeviceSubject: "Maestranze Italia — nuovo dispositivo associato",
    newDeviceBody: (name: string) =>
      `Il dispositivo «${name}» è stato associato al tuo profilo. Se non lo riconosci, contatta subito il concierge.`,
    signature: "Il Concierge di Maestranze Italia",
    ignore: "Se non hai richiesto nulla, puoi ignorare questa email.",
    smsOtp: (code: string) => `Maestranze Italia: il tuo codice di accesso è ${code}. Valido 5 minuti. Non comunicarlo a nessuno.`,
    smsEnroll: (code: string) => `Maestranze Italia: il codice per confermare il tuo cellulare è ${code}. Valido 5 minuti.`,
    pushTitle: "Richiesta di accesso",
    pushBody: "Conferma l'accesso a Maestranze Italia dal web.",
    smsPay: (code: string, amount: string, payee: string) =>
      `Maestranze Italia: codice ${code} per autorizzare il pagamento di ${amount} a ${payee}. Valido 5 minuti. Se non sei tu, non usarlo.`,
    pushPayTitle: "Autorizza il pagamento",
    pushPayBody: (amount: string, payee: string) => `${amount} a ${payee}. Conferma con impronta o volto.`,
  },
  en: {
    activationSubject: "Welcome to Maestranze Italia — confirm your address",
    activationTitle: "Italian craftsmanship awaits you",
    activationBody:
      "Thank you for requesting access to Maestranze Italia. To activate your profile, please confirm this email address within 24 hours.",
    activationCta: "Activate your profile",
    existsSubject: "Maestranze Italia — sign-up attempt",
    existsBody:
      "Someone tried to sign up with this address, which already has a profile. If it was you, sign in or reset your password. Otherwise, ignore this message.",
    existsCta: "Sign in",
    resetSubject: "Maestranze Italia — new password",
    resetBody: "We received a request to set a new password. The link is valid for 30 minutes. If you did not request it, ignore this message.",
    resetCta: "Set a new password",
    newDeviceSubject: "Maestranze Italia — new device linked",
    newDeviceBody: (name: string) =>
      `The device “${name}” has been linked to your profile. If you do not recognise it, contact the concierge immediately.`,
    signature: "The Maestranze Italia Concierge",
    ignore: "If you did not request anything, you can ignore this email.",
    smsOtp: (code: string) => `Maestranze Italia: your sign-in code is ${code}. Valid for 5 minutes. Never share it.`,
    smsEnroll: (code: string) => `Maestranze Italia: the code to confirm your mobile number is ${code}. Valid for 5 minutes.`,
    pushTitle: "Sign-in request",
    pushBody: "Confirm your sign-in to Maestranze Italia on the web.",
    smsPay: (code: string, amount: string, payee: string) =>
      `Maestranze Italia: code ${code} to authorise a payment of ${amount} to ${payee}. Valid 5 minutes. If this isn't you, do not use it.`,
    pushPayTitle: "Authorise the payment",
    pushPayBody: (amount: string, payee: string) => `${amount} to ${payee}. Confirm with fingerprint or face.`,
  },
} as const;

export function texts(locale: string) {
  return T[(locale === "en" ? "en" : "it") as Locale];
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Email in stile editoriale: avorio, inchiostro, un solo accento. */
export function renderEmail(opts: { locale: string; title: string; body: string; cta?: { label: string; url: string } }) {
  const t = texts(opts.locale);
  const button = opts.cta
    ? `<tr><td style="padding:32px 0 8px"><a href="${escape(opts.cta.url)}" style="display:inline-block;background:#1c1a17;color:#f6f1e7;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.24em;text-transform:uppercase;padding:16px 36px">${escape(opts.cta.label)}</a></td></tr>`
    : "";
  const html = `<!doctype html><html lang="${opts.locale}"><body style="margin:0;background:#f6f1e7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e7;padding:48px 16px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fbf8f2;border:1px solid #e4dccb;padding:56px 48px">
<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:.42em;text-transform:uppercase;color:#1c1a17;text-align:center">Maestranze&nbsp;Italia</td></tr>
<tr><td style="padding:12px 0 40px;text-align:center"><div style="width:40px;height:1px;background:#9a4a2e;margin:0 auto"></div></td></tr>
<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.25;color:#1c1a17;font-weight:normal">${escape(opts.title)}</td></tr>
<tr><td style="padding-top:20px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#4a4438">${escape(opts.body)}</td></tr>
${button}
<tr><td style="padding-top:48px;font-family:Georgia,serif;font-style:italic;font-size:14px;color:#7a705f">${escape(t.signature)}</td></tr>
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#9a907d;max-width:560px">${escape(t.ignore)}</p>
</td></tr></table></body></html>`;
  const text = `${opts.title}\n\n${opts.body}\n\n${opts.cta ? `${opts.cta.label}: ${opts.cta.url}\n\n` : ""}${t.signature}`;
  return { html, text };
}
