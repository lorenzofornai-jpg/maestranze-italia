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
| `packages/shared` | ✅ | Schema di registrazione (zod), P.IVA, codice fiscale, cellulare, 107 province, formati dei messaggi firmati |
| `apps/api` | ✅ Identità e accesso | Registrazione, attivazione via email, login con 2FA, dispositivi, sessioni, audit |
| `apps/web` | ✅ Identità e accesso | Home editoriale, registrazione in 4 passi, attivazione, accesso con 2FA, area riservata |
| `apps/mobile` | ✅ Identità e accesso | Associazione con QR o con credenziali + SMS, sblocco biometrico, approvazione degli accessi web |
| Catalogo, ricerca, RFQ, ordini, pagamenti | 🔜 | Vedi §5 |

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

## 5. Prossimi moduli (architettura completa)

| Modulo | Contenuto |
|---|---|
| **KYC / KYB** | Verifica d'impresa (visura camerale, IBAN, titolare effettivo) delegata al fornitore di pagamento; badge «Maison verificata» |
| **Maison e catalogo** | Pagina editoriale, collezioni, schede prodotto (origine, lavorazione, DOP/IGP, minimi d'ordine, listini B2B riservati) |
| **Esplorazione** | Regione → provincia → comune → Maison; ricerca in linguaggio naturale e matching domanda-offerta con un LLM (pgvector) |
| **Richieste e trattative** | RFQ, campionature, offerte, commissioni su misura, messaggistica |
| **Ordini e pagamenti** | Marketplace con split payment (Stripe Connect o Adyen for Platforms): fondi in custodia, rilascio alla consegna, commissione trattenuta automaticamente, rimborsi e controversie; conferma SCA via app |
| **Fatturazione** | Fattura elettronica SDI (commissione del portale; per conto della Maison se delegata), corrispettivi |
| **Logistica** | Spedizioni con tracciamento (catena del freddo per il food), ritiro in bottega |
| **Back-office** | Selezione delle candidature, moderazione, controversie, Concierge |

Infrastruttura consigliata: PostgreSQL gestito in UE; API e web su container (Cloud Run, Fly.io o Render, regione UE);
segreti nel secret manager; WAF e CDN davanti al web; backup giornalieri e PITR; log e audit conservati per GDPR.
