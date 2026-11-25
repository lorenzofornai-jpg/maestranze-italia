# Roadmap — Maestranze Italia

Stato a novembre 2026. ✅ fatto · 🔜 prossimo · ◻️ da pianificare

## Fatto
- ✅ Account domanda/offerta, attivazione via email, 2FA (SMS, TOTP, app), sessioni, audit
- ✅ Maison e catalogo, candidatura e selezione, pagina pubblica, prezzi riservati
- ✅ Esplorazione per territorio e disciplina, ricerca full-text, frasi in linguaggio naturale
- ✅ Ordini, autorizzazione forte del pagamento, custodia, accredito con commissione, rimborsi, controversie (fornitore *sandbox*)
- ✅ SMS Twilio, push Expo, build EAS

## 1. Verifiche da completare
- 🔜 **App su telefono vero**: impronta e volto, notifiche push, QR code (guida in `TEST-SU-TELEFONO.md`)
- 🔜 **Ricerca con l'LLM**: prima prova con una chiave `ANTHROPIC_API_KEY` reale, insieme di frasi d'esempio da verificare
- 🔜 **SMS reali**: account Twilio, mittente alfanumerico «Maestranze» registrato per l'Italia

## 1b. Sicurezza dell'accesso
- ◻️ **«Usa solo l'app e l'autenticatore»**: opzione nell'area riservata che, una volta associata l'app,
  toglie l'SMS dai metodi di accesso e di autorizzazione dei pagamenti (difesa dal *SIM swap*). L'SMS resta
  solo per il recupero dell'account, con verifiche aggiuntive (es. link via email + attesa di sicurezza +
  avviso su tutti i dispositivi). Disattivarla richiede la conferma dall'app.

## 2. Pagamenti reali
- 🔜 **Stripe Connect** (o Adyen for Platforms): adattatore `PaymentProvider`, Stripe Elements in cassa, 3-D Secure, webhook
- 🔜 **Onboarding KYC/KYB delle Maison** su Stripe Express alla selezione; badge «Maison verificata»
- ◻️ Riconciliazione contabile: registro movimenti ↔ estratti del fornitore, report mensile commissioni
- ◻️ Rimborsi parziali e resi

## 3. Fiscale e documenti
- 🔜 **Fattura elettronica SDI** della commissione del portale (intermediario accreditato, es. Fatture in Cloud / Aruba)
- ◻️ Fattura per conto della Maison, se delegata
- ◻️ Pagine legali: Condizioni d'uso e di vendita, informativa privacy, cookie (oggi i link sono segnaposto)
- ◻️ GDPR: esportazione e cancellazione dell'account, conservazione dei log

## 4. Logistica
- ◻️ Corrieri (BRT, GLS, Poste): etichette, tracciamento automatico, consegna confermata dal corriere
- ◻️ Spedizione per Maison: costi e soglie di gratuità; catena del freddo per il food
- ◻️ Ritiro in bottega

## 5. Relazione cliente–Maison
- ◻️ Messaggistica per ordine e per Maison, con notifiche
- ◻️ Richieste di preventivo (RFQ) e forniture ricorrenti per ristoranti e hotel
- ◻️ Commissioni su misura (sartoria, ceramica): bozzetti, acconti, prove
- ◻️ Recensioni verificate (solo dopo ordine concluso)

## 6. Esperienza ed editoriale
- ◻️ Collezioni curate a tema (es. «La tavola dell'Appennino»), pagina per regione
- ◻️ Mappa d'Italia navigabile in monocromia
- ◻️ Gallerie fotografiche per Maison e prodotto, varianti (taglie, formati)
- ◻️ Area riservata: cambio password, gestione cellulare, cronologia accessi
- ◻️ Newsletter e inviti del Concierge
- ◻️ SEO: sitemap, dati strutturati, URL tradotti

## 7. Staff e back-office
- ◻️ Pannello staff: Maison, account, ordini, controversie, sospensioni, commissioni per Maison
- ◻️ Moderazione di testi e immagini
- ◻️ Statistiche: Maison attive, ordini, valore transato, commissioni

## 8. Produzione — prima del lancio (anche con pochi utenti)
Il codice è già impostato per la produzione: API senza stato in memoria (sessioni e sfide nel database),
cambi di stato degli ordini atomici con registro contabile, migrazioni versionate, test sui flussi critici.
Va invece preparata l'infrastruttura:
- 🔜 **Ospitalità vera**: PostgreSQL gestito in UE con backup e ripristino puntuale; API e sito su container
  in UE (es. Cloud Run, Fly.io, Render); dominio e HTTPS; ambiente di prova separato dalla produzione
- 🔜 **Immagini** su archivio a oggetti (S3 / Google Cloud Storage) con CDN, al posto del disco del server:
  indispensabile appena le copie dell'API sono più di una
- 🔜 **Instradamento**: il bilanciatore manda `/api` direttamente all'API sullo stesso dominio, senza passare
  dal sito
- 🔜 **Fornitori reali**: Stripe Connect (vedi §2), Twilio per gli SMS, notifiche push con EAS
- 🔜 **Segreti** nel secret manager del cloud, WAF davanti al sito
- 🔜 **Osservabilità**: log centralizzati, monitoraggio errori (es. Sentry), allarmi, pagina di stato
- 🔜 **CI/CD**: test, migrazioni e pubblicazione automatici a ogni modifica
- ◻️ Pubblicazione dell'app su App Store e Google Play
- ◻️ Penetration test e revisione PSD2/SCA con un consulente prima di gestire denaro reale

## 9. Produzione — con la crescita (decine o centinaia di migliaia di utenti)
Nessuno di questi interventi richiede di riscrivere l'app: sono pezzi da sostituire o aggiungere.
- ◻️ **Invii in coda** (email, SMS, push) con tentativi automatici, invece che durante la richiesta:
  un fornitore lento non rallenta più il sito
- ◻️ **Lavori pianificati** separati dall'API (es. rilascio automatico dei fondi): oggi gira ogni ora dentro
  ogni copia dell'API. Non può pagare due volte, ma con più copie il lavoro si ripete
- ◻️ **Limiti anti-abuso condivisi** tra le copie dell'API (Redis), invece che contati in memoria da ciascuna
- ◻️ **Sessioni**: ultimo accesso aggiornato al massimo una volta al minuto, non a ogni richiesta
- ◻️ **Ricerca dedicata** (es. Meilisearch, o pgvector per la ricerca «per significato») oltre le centinaia di
  migliaia di prodotti; fino ad allora basta PostgreSQL
- ◻️ Repliche di sola lettura del database per elenchi e ricerca, se il carico lo richiede
- ◻️ Test di carico periodici
