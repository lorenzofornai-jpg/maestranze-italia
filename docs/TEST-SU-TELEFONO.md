# Provare l'app su un telefono vero

L'app Maestranze usa tre funzioni native che **Expo Go non basta a provare**:

- la chiave del dispositivo, salvata nel portachiavi e protetta da impronta o volto (`expo-secure-store` con `requireAuthentication`);
- le notifiche push remote (da SDK 53 non funzionano più in Expo Go su Android);
- la fotocamera, per inquadrare il QR code.

Serve quindi una **development build**: la propria app, installata sul telefono, che si collega al computer per il codice.

## 1. Prerequisiti

| | iPhone | Android |
|---|---|---|
| Account | Apple Developer (99 €/anno) per installare su un dispositivo | nessuno |
| Build | nel cloud con EAS, oppure in locale con Xcode | nel cloud con EAS, oppure in locale con Android Studio |
| Biometria | Face ID / Touch ID configurati | impronta o sblocco configurati |

Sul computer: Node 22, pnpm e il progetto avviato come nel README (`pnpm db:migrate`, `pnpm db:seed`, `pnpm dev:api`, `pnpm dev:web`).

## 2. Rendere l'API raggiungibile dal telefono

Il telefono non vede `localhost`. Le strade sono due:

- **Tunnel HTTPS (consigliato)**: funziona ovunque e iOS non blocca l'HTTP in chiaro.
  ```bash
  cloudflared tunnel --url http://localhost:4000
  # → https://qualcosa.trycloudflare.com
  ```
- **Rete locale**: `http://192.168.x.y:4000`, con telefono e computer sulla stessa Wi-Fi (su Android basta, su iOS serve un'eccezione ATS).

Scrivi l'indirizzo in `apps/mobile/app.json` → `expo.extra.apiUrl`.

## 3. Collegare il progetto a EAS (una volta sola)

```bash
npm i -g eas-cli
cd apps/mobile
eas login
eas init          # crea il progetto e scrive il suo ID in app.json → extra.eas.projectId
```

L'ID del progetto serve al token delle notifiche push: senza, l'app funziona ma non riceve notifiche.

## 4. Installare la development build

```bash
# nel cloud (il link per installarla arriva a fine build)
eas build --profile development --platform android   # APK da installare direttamente
eas build --profile development --platform ios       # per iPhone registrati con `eas device:create`

# oppure in locale, con il telefono collegato via cavo
npx expo run:android --device
npx expo run:ios --device
```

Poi avvia il server di sviluppo e apri l'app sul telefono:

```bash
pnpm dev:mobile
```

## 5. Notifiche push

Nel file `apps/api/.env`:

```
PUSH_PROVIDER=expo
# EXPO_ACCESS_TOKEN=…   solo se nel progetto Expo è attiva la «push security»
```

Il token del telefono si registra quando si associa l'app. Per iOS, la prima `eas build` chiede di creare la chiave APNs: accetta, EAS la gestisce da sé. Per Android serve la chiave FCM del progetto Firebase, caricata con `eas credentials`.

## 6. SMS reali

In sviluppo i codici si leggono nel log dell'API. Per riceverli sul telefono:

```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_MESSAGING_SERVICE_SID=MG…   # mittente alfanumerico «Maestranze», oppure:
# TWILIO_FROM=+39…
```

In produzione l'API non parte con `SMS_PROVIDER=console`, perché i codici finirebbero nei log.

## 7. Percorso di prova

Usa gli account dimostrativi creati da `pnpm db:seed`. La password è `Maestranze!2026`; il codice SMS è nel log dell'API, o arriva sul telefono se hai configurato Twilio.

1. **Associa il telefono dal sito.** Accedi sul web come `chef@osteria.it`, apri l'Area riservata, scegli «Associa l'app», poi sul telefono «Inquadra il QR code». Arriva l'email «nuovo dispositivo associato».
2. **Sblocca l'app.** Chiudila e riaprila: chiede l'impronta o il volto ed entra senza password.
3. **Approva un accesso dal web.** Esci dal sito, accedi di nuovo e scegli «App Maestranze». Sul telefono arriva la notifica; tocca Approva e conferma con la biometria. Il browser entra da solo.
4. **Autorizza un pagamento.** Ordina dal Caseificio Irpino (sopra l'ordine minimo di 300 €) e scegli «App Maestranze». Il telefono mostra importo, beneficiario e numero d'ordine; approvando, il pagamento va in custodia.
5. **Primo accesso direttamente dall'app.** Su un altro telefono, o dopo «Dissocia questo telefono», scegli «Accedi con email e password», inserisci il codice SMS e il telefono viene associato senza passare dal sito.

## Cosa resta da verificare sul dispositivo

Questa parte non è stata provata nell'ambiente di sviluppo, che non ha telefoni:

- la richiesta di impronta o volto alla lettura della chiave, su iOS e Android;
- la consegna delle notifiche push e l'apertura dell'app toccandole;
- la lettura del QR code con la fotocamera.

Codice e build sono verificati: tipi, bundle iOS e Android con Metro, e lo stesso formato di firma provato nei test dell'API.
