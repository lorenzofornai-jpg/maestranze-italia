# Provare Maestranze Italia nel browser (GitHub Codespaces)

Non serve installare nulla sul computer: GitHub prepara un ambiente nel cloud con l'app, il database e una
casella di posta di prova, e la avvia da sola.

## 1. Creare il Codespace (la prima volta)

1. Apri il repository su GitHub: **github.com/lorenzofornai-jpg/maestranze-italia**
2. Pulsante verde **Code** → scheda **Codespaces** → **Create codespace on main**
3. Attendi la preparazione, **circa 5 minuti** la prima volta: installazione, database e dati di prova.
   Puoi seguire l'avanzamento nel terminale in basso.

## 2. Aprire il sito

Quando è pronto, il sito si apre in una nuova scheda. Se non succede:

- in basso, scheda **Porte** (*Ports*) → riga **Maestranze Italia (3000)** → icona del mappamondo.

Dopo l'avvio il sito impiega circa un minuto a essere disponibile: se la pagina non risponde, ricaricala.

## 3. Accedere

Premi **Accedi** e usa un account dimostrativo. La password è sempre `Maestranze!2026`.

| Email | Profilo |
|---|---|
| `chef@osteria.it` | Ristorante: domanda, vede i prezzi riservati |
| `staff@maestranze.it` | Staff del portale: selezione delle Maison, controversie |
| `caseificio0@maison.maestranze.it` | Una Maison: ordini ricevuti. Altre: `podere1@…`, `sartoria2@…` |

**Il codice SMS** compare direttamente sulla pagina, sopra le caselle: «Ambiente di prova: il codice inviato
via SMS è 123456». Succede solo nell'ambiente di prova; con un fornitore SMS reale il codice arriva soltanto al telefono.

Lo trovi anche nella posta di prova (scheda **Porte** → riga **Posta e SMS di prova (8025)** → mappamondo),
oppure nel terminale con `grep "codice" /tmp/maestranze-api.log | tail -1`. Nella posta di prova arrivano anche
le email: attivazione dei nuovi account, avvisi d'ordine, esito della selezione.

## 4. Le volte successive

- Da **github.com/codespaces** riapri il Codespace esistente: dati e account restano, e il sito riparte da solo.
- Un Codespace inattivo si ferma dopo 30 minuti. Riaprendolo, tutto riparte.
- Gli account personali GitHub hanno ogni mese un uso gratuito di Codespaces. Quando non ti serve,
  ferma il Codespace dal menu di github.com/codespaces.

## 5. Comandi utili (terminale del Codespace)

```bash
bash .devcontainer/start.sh          # riavvia sito e API
bash .devcontainer/start.sh stop     # ferma
tail -f /tmp/maestranze-api.log      # log dell'API
pnpm test                            # test automatici
```

## 6. L'app sul telefono (Expo Go)

Una prova dell'app mobile senza installarla: si apre dentro **Expo Go**.

1. Sull'iPhone (o Android) installa **Expo Go** dall'App Store / Play Store.
2. Nel terminale del Codespace:
   ```bash
   bash .devcontainer/mobile.sh
   ```
   Se lo script chiede di rendere pubblica la porta 4000: scheda **Porte** → riga 4000 (se manca,
   «Aggiungi porta» → 4000) → clic destro → **Visibilità porta → Public**, poi rilancia lo script.
3. Compare un QR code: inquadralo con la **Fotocamera** dell'iPhone e tocca «Apri in Expo Go».
   Il primo caricamento richiede un minuto.
4. Nell'app: **Accedi con email e password** (`chef@osteria.it`): il codice di prova compare nella schermata.
   Il telefono si associa al profilo e da lì entri con Face ID.
5. Prova l'approvazione: sul sito esci, accedi di nuovo e scegli **App Maestranze**. Apri l'app sul
   telefono: trovi la richiesta, tocca **Approva** e conferma con Face ID.

Limiti di Expo Go: le notifiche push non arrivano (le richieste si vedono aprendo l'app) e l'app resta
disponibile finché il Codespace e lo script sono accesi. Con la porta 4000 pubblica l'API del Codespace è
raggiungibile da internet: finita la prova, rimettila **Private**. Per l'installazione vera, vedi `TEST-SU-TELEFONO.md`.

## 7. Ricerca con l'LLM (chiave Anthropic)

La ricerca «Cerca come lo diresti a un amico» usa l'LLM se trova la variabile `ANTHROPIC_API_KEY`;
altrimenti usa le regole. La chiave si dà come **secret di Codespaces**, mai in un file del repository:

1. github.com/settings/codespaces → **Codespaces secrets**
2. Se esiste già `ANTHROPIC_API_KEY` (es. per il process mining): **modifica** → *Repository access* →
   aggiungi `maestranze-italia`. Altrimenti **New secret**: nome `ANTHROPIC_API_KEY`, valore la chiave,
   repository `maestranze-italia` (e gli altri che la usano).
3. Nel Codespace compare l'avviso per ricaricare: accetta (oppure fermalo e riaprilo da github.com/codespaces).
4. Nel terminale: `bash .devcontainer/start.sh` → deve dire «LLM attivo».

Prova su **Le Maison** con una frase: sotto la ricerca compare «Interpretato dall'LLM». Se invece dice
come prima, nel terminale `grep "\[search\]" /tmp/maestranze-api.log | tail -3` mostra il motivo.

## Note

- I link del Codespace sono **privati**: si aprono solo con il tuo account GitHub. Per mostrare il sito a
  un'altra persona, nella scheda Porte puoi rendere pubblica la porta 3000. Chiunque abbia il link potrà
  allora vederlo: rimettila privata dopo la demo.
- L'app per telefono non gira nel Codespace: per quella vedi `TEST-SU-TELEFONO.md`.
