# Roadmap — Maestranze Italia

Stato a novembre 2026. ✅ fatto · 🔜 prossimo · ◻️ da pianificare

## Fatto
- ✅ Account domanda/offerta, attivazione via email, 2FA (SMS, TOTP, app), sessioni, audit
- ✅ Maison e catalogo, candidatura e selezione, pagina pubblica, prezzi riservati
- ✅ Esplorazione per territorio e disciplina, ricerca full-text, frasi in linguaggio naturale
- ✅ Ordini, autorizzazione forte del pagamento, custodia, accredito con commissione, rimborsi, controversie (fornitore *sandbox*)
- ✅ SMS Twilio, push Expo, build EAS
- ✅ **Atelier: videochiamate con sottotitoli tradotti e appuntamenti nei due fusi orari**
- ✅ **Atelier, primo passo (sartoria)**: brief guidato con misure, conversazione tradotta con dettatura e foto private, proposta con versioni, acconto e saldo in custodia, risposta entro 96 ore, avviso sui contatti esterni

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
- ✅ Commissioni su misura per la sartoria, altre arti in arrivo: vedi **5b. L'Atelier**
- ◻️ Recensioni verificate (solo dopo ordine concluso)

## 5b. L'Atelier — su misura e su commissione
Uno spazio privato per ogni commissione, dentro il portale e l'app, dove cliente e Maison si conoscono prima
dell'acquisto e dove l'acquisto si conclude.

**Decisioni prese (novembre 2026)**: si parte dalla **sartoria**; il cliente può essere **ovunque nel mondo**
(consegna internazionale, conversazione in 18 lingue); la Maison **risponde entro 96 ore**, altrimenti la
richiesta si chiude e si avvisano entrambi; l'**acconto** (20–70%, lo sceglie il maestro) è in custodia e
rimborsabile finché il maestro non **inizia la lavorazione**, poi passa alla Maison e non è più rimborsabile;
il saldo resta in custodia fino alla consegna (rilascio automatico dopo 14 giorni, come gli ordini).
Sì anche all'assistente di bottega **con la voce** (passo 3).

**Passo 1 — fatto**
- ✅ Richiesta in tre passi dalla pagina della Maison: capo, occasione, tessuto, colore, descrizione, budget, data,
  paese di consegna, lingua; misure guidate (10 misure con istruzioni, vestibilità) con consenso esplicito
- ✅ Conversazione tradotta con l'LLM, glossario di sartoria (i termini d'arte restano in italiano), originale
  sempre consultabile; dettatura vocale del browser; foto private servite solo ai due partecipanti
- ✅ Proposta del maestro (prezzo, acconto, settimane, prove), richiesta di modifiche, nuove versioni
- ✅ Accettazione con indirizzo internazionale e autorizzazione forte; acconto e saldo sono ordini in custodia,
  con le stesse regole di commissione, rimborso e controversia degli ordini dal catalogo
- ✅ Inizio lavorazione, annotazione delle prove, richiesta del saldo, spedizione con tracciamento, conferma
- ✅ Avviso gentile su email, telefoni, IBAN, link e app di messaggistica (si può inviare comunque; resta traccia)
- ✅ Email a ogni passaggio (messaggi raggruppati ogni 15 minuti), elenco con messaggi da leggere e scadenze

**Passo 1 — da completare**
- ◻️ **Messaggi vocali veri** (audio conservato, trascritto e tradotto): serve un servizio di trascrizione
  (es. Whisper, Deepgram); oggi c'è la dettatura del browser, che scrive il testo senza salvare l'audio
- ◻️ **IVA per l'estero**: oggi tutto al 22%; per consegne fuori UE serve la cessione all'esportazione (non imponibile)
  e per i privati UE l'IVA del paese di destinazione (OSS) — da decidere con il commercialista
- ◻️ Notifiche push sull'app per i nuovi messaggi; pannello staff con le conversazioni segnalate per i contatti
- ◻️ Altre arti: ceramica (servizio, quantità, decoro, logo per hotel), selleria, cantina (etichetta personalizzata)
- ◻️ Clausola di non aggiramento nel contratto Maison (da verificare con un legale, regolamento UE 2019/1150);
  commissione decrescente per i clienti abituali

**Passo 2**
- ✅ **Videochiamate nell'Atelier**: audio e video diretti tra i due browser (WebRTC), il portale fa da centralino
  (squillo, risposta, rifiuto, chiamata persa dopo 60 secondi); nessuna registrazione, nella conversazione resta
  solo «Videochiamata · N min»
- ✅ **Sottotitoli tradotti in diretta**: il browser trascrive chi parla nella sua lingua, il portale traduce con
  l'LLM, la traduzione arriva all'altro sul canale dati della chiamata; originale consultabile
- ✅ **Appuntamenti**: proposta di giorno, ora e durata, accettazione o controproposta; ciascuno vede l'orario
  nel proprio fuso e in quello dell'altra parte; email alla proposta e alla conferma
- 🔜 **Prova su iPhone e iPad**: Safari può non concedere insieme microfono della chiamata e riconoscimento
  vocale; se succede, sottotitoli solo da chi parla da computer, oppure trascrizione lato server (vedi sotto)
- ◻️ **Server TURN** per le reti che bloccano la connessione diretta (reti mobili, aziendali): già previsto in
  configurazione (`TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`); servizio gestito (es. Cloudflare, Twilio)
  o proprio (coturn)
- ✅ Ognuno vede solo i sottotitoli dell'altro, sempre nella propria lingua; selettore «Parlo in» per chi cambia
  lingua durante la chiamata (il riconoscimento del browser ascolta una lingua alla volta)
- ◻️ Trascrizione lato server (es. Whisper, Deepgram) con **riconoscimento automatico della lingua di ogni
  frase** (niente più selettore), sottotitoli uguali su ogni dispositivo;
  verbale della chiamata salvato solo con il consenso di entrambi
- ◻️ Squillo come notifica push sull'app; promemoria via email 1 ora prima dell'appuntamento; file .ics
- ◻️ Interprete umano su richiesta per commissioni di valore; chiamate a più persone (es. sarto e modellista)
- ◻️ **Il Concierge** (assistente LLM del portale): aiuta il cliente a scrivere il brief, suggerisce le Maison adatte,
  riassume la conversazione; dichiara sempre di essere un assistente automatico

**Passo 3**
- ◻️ **Assistenti di bottega** (LLM per singola Maison, su contenuti approvati dalla Maison), **anche con la voce**:
  guida alla presa delle misure, abbinamenti del sommelier, scelta dei materiali. Non promettono prezzi né tempi:
  la proposta è del maestro
- ◻️ *Trunk show*: il maestro in trasferta (Milano, Londra, New York), prove prenotabili dal portale
- ◻️ **Privacy**: conservazione limitata di misure e foto dopo la consegna, esportazione e cancellazione su richiesta

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

## 10. Temi strategici aperti (brainstorming di novembre 2026)
- ◻️ **Identità**: cosa distingue Maestranze da un e-commerce (selezione, racconto, relazione); B2B come cuore
  economico, privato come immagine: decidere quale guida il prodotto
- ◻️ **Modello di ricavo**: oltre la commissione, abbonamento Maison (vetrina premium), abbonamento professionisti,
  servizi a pagamento (fotografia, traduzioni, logistica, export); verificare i margini reali delle Maison
- ◻️ **Su misura e su commissione**: vedi 5b
- ◻️ **Il professionista che ordina**: ordini ricorrenti, listini dedicati, pagamento a 30/60 giorni, fattura
  elettronica, più utenti per azienda con permessi
- ◻️ **Esperienze**: visite in bottega, degustazioni, giornate col maestro, con tono non turistico
- ◻️ **Ruolo dell'app**: solo chiave d'accesso elegante, o anche vetrina e ordini
- ◻️ **Lancio**: quante Maison (poche eccellenti o molte buone), quale territorio o arte per primi, figura sul campo
  («scout» delle Maison) per i maestri poco digitali
- ◻️ **Fiducia e qualità**: recensioni sì o no, «garanzia Maestranze», gestione delle consegne non conformi su
  prodotti artigianali per natura diversi uno dall'altro
