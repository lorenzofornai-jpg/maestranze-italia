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

## 8. Produzione
- 🔜 Deploy in UE: PostgreSQL gestito, API e web su container, immagini su archivio a oggetti + CDN
- 🔜 Segreti nel secret manager, WAF, backup e PITR, monitoraggio ed errori (Sentry o simili)
- ◻️ Pubblicazione dell'app su App Store e Google Play
- ◻️ Test di carico, penetration test, revisione PSD2/SCA con un consulente
