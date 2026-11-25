# Maestranze Italia

*Il portale del saper fare italiano.* Le Maison del Made in Italy (food, beverage, sartoria, sport, artigianato)
incontrano ristoratori, albergatori, aziende e intenditori. Esclusivo, editoriale, sicuro come una banca.

Interfaccia bilingue **IT | EN**. Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md) · Architettura e sicurezza: [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md) · App sul telefono: [`docs/TEST-SU-TELEFONO.md`](docs/TEST-SU-TELEFONO.md).

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

## Provarlo senza installare nulla

Il modo più semplice è **GitHub Codespaces**: sul repository premi **Code → Codespaces → Create codespace
on main** e il sito si apre da solo nel browser, con database, dati di prova e posta di prova (dove
arrivano anche i codici SMS). Guida: [`docs/AVVIO-CODESPACES.md`](docs/AVVIO-CODESPACES.md).

## Avvio in locale

Servono **Node 22**, **pnpm** (`npm i -g pnpm`) e **Docker Desktop** (per database e posta di prova).

```bash
git clone https://github.com/lorenzofornai-jpg/maestranze-italia.git
cd maestranze-italia
pnpm install
docker compose up -d                   # PostgreSQL + Mailpit (email su http://localhost:8025)

cp apps/api/.env.example apps/api/.env # su Windows: copy apps\api\.env.example apps\api\.env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# incolla il risultato in apps/api/.env alla riga DATA_ENCRYPTION_KEY=

pnpm db:migrate
pnpm --filter @maestranze/api db:seed  # 8 Maison dimostrative e due account di prova
```

Poi, in **due terminali** separati:

```bash
pnpm dev:api    # API su http://localhost:4000 — qui compaiono i codici SMS
pnpm dev:web    # sito su http://localhost:3000
```

### Accedere

Apri http://localhost:3000, scegli **Accedi** e usa un account dimostrativo (password `Maestranze!2026`):

| Email | Profilo |
|---|---|
| `chef@osteria.it` | Ristorante (domanda, vede i prezzi riservati) |
| `staff@maestranze.it` | Staff del portale (selezione, controversie) |
| `caseificio0@maison.maestranze.it` | Maison (offerta) — anche `podere1@…`, `sartoria2@…`, ecc. |

Il **codice SMS** non arriva al telefono in sviluppo: lo trovi nel terminale di `pnpm dev:api`, in una riga
come `[sms] +3933…: Maestranze Italia: il tuo codice di accesso è 123456`. Le email (attivazione, avvisi
d'ordine) si leggono su http://localhost:8025.

Per un account nuovo: **Richiedi l'accesso**, apri il link di attivazione da Mailpit, accedi e conferma il
cellulare con il codice dal terminale. Per nominare staff un account: `pnpm --filter @maestranze/api admin:grant tua@email.it`.

App mobile: vedi [`docs/TEST-SU-TELEFONO.md`](docs/TEST-SU-TELEFONO.md).

## Test

```bash
pnpm test        # 63 test: accesso e 2FA, catalogo e selezione, ricerca, ordini e pagamenti, canali SMS/push
pnpm typecheck
```

I test dell'API usano il database `maestranze_test` (`TEST_DATABASE_URL` per cambiarlo).
