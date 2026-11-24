import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { eq } from "drizzle-orm";
import { devices } from "./db/schema";
import { ConsolePush, ConsoleSms, ExpoPush, TwilioSms } from "./lib/channels";
import { LiveNotifier } from "./lib/notifications";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const log = (m: string) => console.log(m);
const sms =
  config.SMS_PROVIDER === "twilio"
    ? new TwilioSms(
        {
          accountSid: config.TWILIO_ACCOUNT_SID!,
          authToken: config.TWILIO_AUTH_TOKEN!,
          from: config.TWILIO_FROM,
          messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID,
        },
        log,
      )
    : new ConsoleSms(log);
const push =
  config.PUSH_PROVIDER === "expo"
    ? new ExpoPush(
        {
          accessToken: config.EXPO_ACCESS_TOKEN,
          // App disinstallata: il token non vale più, lo si toglie dal dispositivo.
          onInvalidToken: async (token) => {
            await db.update(devices).set({ pushToken: null }).where(eq(devices.pushToken, token));
          },
        },
        log,
      )
    : new ConsolePush(log);
const notifier = new LiveNotifier(config.SMTP_URL, config.MAIL_FROM, sms, push, log);
const app = await buildApp({ db, config, notifier, logger: config.NODE_ENV !== "production" });

await app.listen({ port: config.PORT, host: "0.0.0.0" });

// Rilascio automatico dei fondi per gli ordini spediti da oltre il termine senza segnalazioni.
setInterval(() => {
  app.orders.autoRelease().catch((err) => app.log.error(err));
}, 60 * 60 * 1000).unref();
