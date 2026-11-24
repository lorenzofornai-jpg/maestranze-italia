import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { LiveNotifier } from "./lib/notifications";

const config = loadConfig();
const { db } = createDb(config.DATABASE_URL);
const notifier = new LiveNotifier(config.SMTP_URL, config.MAIL_FROM, config.PUSH_PROVIDER, (m) => console.log(m));
const app = await buildApp({ db, config, notifier, logger: config.NODE_ENV !== "production" });

await app.listen({ port: config.PORT, host: "0.0.0.0" });

// Rilascio automatico dei fondi per gli ordini spediti da oltre il termine senza segnalazioni.
setInterval(() => {
  app.orders.autoRelease().catch((err) => app.log.error(err));
}, 60 * 60 * 1000).unref();
