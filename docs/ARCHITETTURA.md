# Maestranze Italia — Architettura

Portale che incrocia l'**offerta** delle Maison italiane (food, beverage, sartoria, sport, artigianato)
con la **domanda** di ristoratori, albergatori, aziende e privati. Il portale gestisce le transazioni
e trattiene una **commissione**.

## 1. Mappa dei componenti

```
                ┌──────────────────────┐        ┌───────────────────────┐
  Browser ────▶ │  apps/web (Next.js)  │ /api ─▶│  apps/api (Fastify)   │──▶ PostgreSQL
                │  sito + area riserv. │ proxy  │  dominio + sicurezza  │
                └──────────────────────┘        │                       │──▶ SMTP (email)
  Telefono ───────────────────────────────────▶ │                       │──▶ Gateway SMS
  apps/mobile (Expo / React Native)             │                       │──▶ Expo Push (APNs/FCM)
                                                └───────────────────────┘──▶ PSP (Stripe Connect / Adyen for Platforms)
                packages/shared: schemi zod, validatori italiani, formati firmati
```

| Modulo | Stato | Contenuto |
|---|---|---|
| `packages/shared` | ✅ | Schemi zod comuni (registrazione, Maison, prodotti, filtri, ordini), validatori italiani, 107 province, calcolo degli importi, formati firmati |
| Identità e accesso | ✅ | Registrazione, attivazione via email, 2FA (SMS, TOTP, app), dispositivi, sessioni, audit |
| Maison e catalogo | ✅ | Profilo editoriale bilingue, collezione, immagini verificate, candidatura e selezione dello staff, pagina pubblica, prezzi riservati |
| Esplorazione e ricerca | ✅ | Regione → provincia → comune, faccette, full-text italiano/inglese, frasi in linguaggio naturale (regole o LLM) |
| Ordini e pagamenti | ✅ (sandbox) | Prezzi con IVA per aliquota, SCA legata all'importo, fondi in custodia, accredito al netto della commissione, rimborsi, controversie, rilascio automatico |
| Integrazioni | ✅ | SMS Twilio, push Expo, build EAS; adattatore Stripe Connect documentato (§6) |
| `apps/mobile` | ✅ | Chiave biometrica, accesso diretto, approvazione di accessi e pagamenti con importo e beneficiario |

## 2. Account: domanda e offerta

| Campo | Domanda (`BUYER`) | Offerta (`MAKER`) |
|---|---|---|
| Soggetto | Persona fisica (codice fiscale) o impresa (P.IVA) | Solo impresa con P.IVA, anche ditta individuale |
| Settori | Ristorazione, ospitalità, retail, azienda, privato, altro | Food, beverage, sartoria, sport, artigianato |
| Territorio | Provincia + comune | Provincia + comune (base dell'esplorazione per territorio) |

Stati dell'account: `PENDING_EMAIL → PENDING_MFA → ACTIVE` (poi `LOCKED`/`SUSPENDED`).

## 3. Procedura di attivazione e accesso (modello «home banking»)

### 3.1 Registrazione e attivazione
1. **Registrazione** (`POST /v1/auth/register`): dati validati con lo stesso schema su client e server.
   Password con Argon2id. La risposta è sempre `202`: se l'email esiste già, al titolare arriva un avviso
   e chi tenta non scopre nulla.
2. **Email di attivazione**: link monouso valido 24 h. Nel database si salva solo lo SHA-256 del token.
3. **Clic sul link** (`POST /v1/auth/activate`): l'email è confermata e lo stato diventa `PENDING_MFA`.
4. **Primo accesso**: email + password, poi un **codice SMS** al cellulare dichiarato. Il codice conferma il
   numero, che diventa il primo fattore, e il profilo passa ad `ACTIVE`.

### 3.2 Accesso dal web
```
email + password ──▶ sfida (loginToken, 5 min) ──▶ secondo fattore ──▶ cookie di sessione
                                                    ├─ App Maestranze (notifica push, approvazione biometrica)
                                                    ├─ App di autenticazione (TOTP, RFC 6238)
                                                    └─ SMS (OTP a 6 cifre, 5 min)
```
- I metodi sono proposti dal più forte: app, poi TOTP, poi SMS.
- OTP: 6 cifre da un generatore casuale crittografico, legato alla sfida (`hash(idSfida:codice)`), valido 5 minuti,
  al massimo 3 invii (uno ogni 30 secondi) e 5 tentativi. Dopo 5 errori la sfida si chiude.
- Password errata 5 volte: blocco di 15 minuti. «Email inesistente» e «password errata» danno lo stesso
  messaggio, con tempi di risposta uniformati.
- TOTP: segreto cifrato a riposo (AES-256-GCM); lo stesso codice non si accetta due volte.

### 3.3 App mobile come chiave (stile Fineco)
- All'associazione l'app genera una coppia di chiavi **Ed25519**. La privata resta nel Keychain (iOS) o nel
  Keystore (Android), leggibile **solo dopo impronta o volto** (`requireAuthentication`). Il server conosce solo la pubblica.
- **Associazione**:
  - dal sito: Area riservata → «Associa l'app» → QR code monouso valido 5 minuti;
  - direttamente dall'app: email + password + SMS, poi associazione automatica (richiede un accesso fatto da meno di 10 minuti).

  In entrambi i casi la nuova chiave firma la propria richiesta (prova di possesso) e il titolare riceve un'email
  «nuovo dispositivo».
- **Accesso diretto dall'app**: nonce monouso (60 s) dal server → firma sbloccata con la biometria → sessione mobile.
  Possesso più inerenza: è autenticazione forte senza OTP.
- **Approvazione degli accessi web**: notifica push → l'app mostra origine (IP, browser, ora) → Approva o Rifiuta,
  firmando `challengeId + nonce + decisione`. Una firma non si può riusare su un'altra sfida.
- **Revoca** di un dispositivo dal sito: si chiudono le sue sessioni e la sua chiave non vale più.

### 3.4 Sessioni
- Token opaco di 256 bit. Nel database solo l'hash, così la sessione è revocabile in ogni momento.
- Web: cookie `httpOnly`, `Secure` in produzione, `SameSite=Strict`, più il controllo dell'`Origin` contro il CSRF.
  L'API passa dal proxy `/api` dello stesso dominio.
- App: `Authorization: Bearer`, tenuto solo in memoria.
- Scadenza dopo 15 minuti di inattività e comunque dopo 8 ore. Il cambio password chiude tutte le sessioni.
- Registro di sicurezza (`audit_events`) per ogni evento rilevante.

### 3.5 Pronto per i pagamenti (SCA / PSD2)
La sfida (`auth_challenges`) ha già i campi `purpose` (`LOGIN` | `TRANSACTION`) e `details`. Per confermare un pagamento
basta crearla con importo e beneficiario: l'app li mostra e li firma (*dynamic linking*), con lo stesso flusso dell'accesso.

## 4. Mappa delle rotte API (`/v1`)

| Rotta | Uso |
|---|---|
| `POST auth/register` · `auth/activate` · `auth/activation/resend` | Registrazione e attivazione |
| `POST auth/login` | Password → sfida |
| `POST auth/mfa/sms` · `auth/mfa/verify` | OTP SMS / TOTP |
| `POST auth/mfa/push` · `auth/mfa/push/poll` | Approvazione dall'app |
| `POST auth/password/forgot` · `auth/password/reset` · `auth/logout` | Password e uscita |
| `POST device/enroll` · `device/nonce` · `device/login` | Chiave del dispositivo |
| `POST device/approvals` · `device/approvals/respond` · `GET me/approvals` | Richieste da approvare |
| `GET me` · `POST me/mfa/totp/setup|confirm` · `POST me/devices/pairing` · `GET/DELETE me/devices` | Area riservata |

## 5. Catalogo, esplorazione, ordini

### Maison e selezione
- Un account di offerta crea **una** Maison: nome, disciplina, motto, storia e mestiere in italiano (obbligatorio) e inglese (facoltativo), territorio, riconoscimenti, condizioni per i professionisti.
- Le immagini si accettano solo se i primi byte sono davvero JPG, PNG o WebP; massimo 8 MB. In locale finiscono su disco (`MEDIA_DIR`), in produzione su un archivio a oggetti dietro la stessa interfaccia.
- La candidatura richiede copertina e almeno un prodotto visibile. Lo staff seleziona fissando la commissione, oppure rifiuta con una motivazione; la Maison riceve l'esito via email.
- Il prezzo riservato (netto) è visibile solo ai clienti professionali e allo staff.

### Esplorazione
- Ogni Maison ha un indice `tsvector` pesato: nome e territorio, poi motto e prodotti, poi racconto. Si interroga in italiano e in inglese, senza accenti, con una variante per prefisso per le forme che lo stemmer non unifica.
- Se nessuna Maison contiene tutte le parole, la ricerca si allarga ad almeno una e lo dice (`relaxed`).
- `POST /v1/search/interpret` trasforma una frase in filtri. Usa l'LLM via Anthropic SDK (`messages.parse` con schema zod, sforzo basso, fallback lato server) se `ANTHROPIC_API_KEY` è configurata; altrimenti usa le regole (discipline, province, zone storiche come Irpinia o Langhe). Se l'LLM non risponde si torna alle regole.

### Ordini e denaro
```
AWAITING_AUTHORIZATION ─SCA─▶ PAID (fondi in custodia) ─▶ ACCEPTED ─▶ SHIPPED ─▶ DELIVERED ─▶ COMPLETED (accredito)
        │                       │                            │            │
        └─ annullato            └─ rifiuto Maison / annullo  └─ DISPUTED ─┴─▶ staff: REFUNDED oppure COMPLETED
                                   cliente → rimborso
```
- Un ordine riguarda una sola Maison. Il server ricalcola sempre prezzi, disponibilità, minimi e IVA.
  - Cliente privato: listino IVA inclusa, IVA scorporata.
  - Cliente professionale: prezzo riservato netto più IVA all'aliquota del prodotto (4, 5, 10 o 22%), con ordine minimo della Maison.
- **SCA con dynamic linking**: l'autorizzazione usa i fattori dell'accesso, ma la sfida è di tipo `TRANSACTION` e porta importo e beneficiario, che compaiono nell'SMS e sull'app. Una sfida di pagamento non apre mai una sessione e una di accesso non autorizza mai un pagamento (test dedicato).
- Le quantità si prenotano in modo atomico al pagamento e tornano disponibili se l'incasso fallisce o l'ordine viene annullato.
- **Registro contabile** (`ledger_entries`): CHARGE, COMMISSION, PAYOUT, REFUND. Il rilascio blocca lo stato prima del trasferimento, quindi non può esserci un doppio accredito.
- Rilascio automatico dopo `AUTO_RELEASE_DAYS` (14) dalla spedizione senza segnalazioni; il controllo gira ogni ora nel processo dell'API.

## 6. Pagamenti reali: collegare Stripe Connect

Il codice parla con un `PaymentProvider` (`apps/api/src/orders/payments.ts`). Oggi è attivo il `SandboxPaymentProvider`. Per andare in produzione:

1. **Onboarding delle Maison**: account Stripe Connect *Express* creato alla selezione. La Maison completa la verifica KYC/KYB su Stripe; il suo `acct_…` si salva sulla Maison.
2. **charge**: PaymentIntent sul conto del portale con `transfer_group` = numero d'ordine. La carta si raccoglie sul web con Stripe Elements dopo la nostra SCA, e Stripe gestisce 3-D Secure.
3. **payout**: Transfer verso l'account della Maison per `payoutCents`. La commissione resta al portale.
4. **refund**: Refund del PaymentIntent.
5. **Webhook** Stripe (`payment_intent.succeeded`, `charge.dispute.created`) collegati alle transizioni dell'ordine.

Adyen for Platforms segue lo stesso schema. Restano da fare: **fattura elettronica SDI** (commissione del portale; per conto della Maison se delegata), spedizioni con etichette e tracciamento dal corriere, messaggistica cliente–Maison, richieste di preventivo (RFQ).

Infrastruttura consigliata: PostgreSQL gestito in UE; API e web su container (Cloud Run, Fly.io o Render, regione UE); immagini su archivio a oggetti con CDN; segreti nel secret manager; WAF e CDN davanti al web; backup giornalieri e PITR; log e audit conservati secondo il GDPR.
