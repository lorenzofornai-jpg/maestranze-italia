# Maestranze Italia

*Il portale del saper fare italiano.* Le Maison del Made in Italy (food, beverage, sartoria, sport, artigianato)
incontrano ristoratori, albergatori, aziende e intenditori. Esclusivo, editoriale, sicuro come una banca.

Interfaccia bilingue **IT | EN**. Architettura e sicurezza: [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md).

## Struttura

```
apps/api       Fastify + Drizzle + PostgreSQL — identità, 2FA, dispositivi, sessioni
apps/web       Next.js — sito editoriale, registrazione, accesso, area riservata
apps/mobile    Expo / React Native — chiave biometrica, accesso diretto, approvazioni
packages/shared  schemi e validatori comuni (P.IVA, codice fiscale, province)
```

## Avvio in locale

```bash
pnpm install
docker compose up -d                  # PostgreSQL + Mailpit (email su http://localhost:8025)
cp apps/api/.env.example apps/api/.env
# imposta DATA_ENCRYPTION_KEY con: openssl rand -base64 32
pnpm db:migrate
pnpm dev:api                          # http://localhost:4000
pnpm dev:web                          # http://localhost:3000
pnpm dev:mobile                       # Expo (imposta extra.apiUrl in apps/mobile/app.json con l'IP del computer)
```

In sviluppo gli SMS e le notifiche push si leggono nel log dell'API; i link delle email compaiono anche lì.

## Test

```bash
pnpm test        # 29 test: validatori + flussi completi di registrazione, 2FA, app, recupero password
pnpm typecheck
```

I test dell'API usano il database `maestranze_test` (`TEST_DATABASE_URL` per cambiarlo).
