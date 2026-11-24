# Maestranze Italia

*Il portale del saper fare italiano.* Le Maison del Made in Italy (food, beverage, sartoria, sport, artigianato)
incontrano ristoratori, albergatori, aziende e intenditori. Esclusivo, editoriale, sicuro come una banca.

Interfaccia bilingue **IT | EN**. Architettura e sicurezza: [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md) · App sul telefono: [`docs/TEST-SU-TELEFONO.md`](docs/TEST-SU-TELEFONO.md).

## Cosa c'è

- **Account** di domanda e di offerta, attivazione via email, doppia autenticazione «come in banca»: SMS, app di autenticazione o conferma biometrica dall'app.
- **Maison**: profilo editoriale, collezione, candidatura e selezione dello staff, prezzi riservati ai professionisti.
- **Esplora**: territori (regione → provincia → comune), Arti, ricerca in linguaggio naturale.
- **Ordini**: cassa, autorizzazione forte del pagamento con importo e beneficiario, fondi in custodia, accredito alla Maison al netto della commissione, rimborsi e controversie.

## Struttura

```
apps/api         Fastify + Drizzle + PostgreSQL — identità e 2FA, catalogo, ricerca, ordini, pagamenti, notifiche
apps/web         Next.js — sito editoriale, esplorazione, pagine Maison, cassa, area riservata, selezione
apps/mobile      Expo / React Native — chiave biometrica, accesso diretto, approvazione di accessi e pagamenti
packages/shared  schemi, validatori italiani, territori, calcolo degli importi
```

## Avvio in locale

```bash
pnpm install
docker compose up -d                  # PostgreSQL + Mailpit (email su http://localhost:8025)
cp apps/api/.env.example apps/api/.env
# imposta DATA_ENCRYPTION_KEY con: openssl rand -base64 32
pnpm db:migrate
pnpm --filter @maestranze/api db:seed   # 8 Maison dimostrative, staff@maestranze.it e chef@osteria.it (password Maestranze!2026)
pnpm --filter @maestranze/api admin:grant tua@email.it   # nomina staff un account
pnpm dev:api                          # http://localhost:4000
pnpm dev:web                          # http://localhost:3000
pnpm dev:mobile                       # Expo (imposta extra.apiUrl in apps/mobile/app.json con l'IP del computer)
```

In sviluppo gli SMS e le notifiche push si leggono nel log dell'API; i link delle email compaiono anche lì.

## Test

```bash
pnpm test        # 63 test: accesso e 2FA, catalogo e selezione, ricerca, ordini e pagamenti, canali SMS/push
pnpm typecheck
```

I test dell'API usano il database `maestranze_test` (`TEST_DATABASE_URL` per cambiarlo).
