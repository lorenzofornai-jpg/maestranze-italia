#!/usr/bin/env bash
# Avvia l'app mobile per Expo Go (iPhone o Android) dal Codespace.
#   bash .devcontainer/mobile.sh
# Il telefono scarica l'app attraverso un tunnel e parla con l'API sulla porta 4000, che deve essere pubblica.
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  API_URL="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  API_URL="http://${IP:-localhost}:4000"
fi

if ! curl -s -o /dev/null -m 3 http://localhost:4000/health; then
  echo "L'API non è avviata: lancio bash .devcontainer/start.sh e attendo…"
  bash .devcontainer/start.sh >/dev/null
  for _ in $(seq 1 40); do curl -s -o /dev/null -m 2 http://localhost:4000/health && break; sleep 3; done
fi

if [ -n "${CODESPACE_NAME:-}" ]; then
  # Il telefono non ha l'accesso GitHub: la porta dell'API deve essere pubblica.
  gh codespace ports visibility 4000:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
  # Subito dopo un avvio l'inoltro può rispondere 502 per qualche secondo: si riprova.
  for _ in $(seq 1 10); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API_URL/health")
    [ "$STATUS" = "200" ] && break
    sleep 3
  done
  if [ "$STATUS" = "302" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
    cat <<MSG

⚠  La porta 4000 è privata: il telefono non può raggiungere l'API (${STATUS}).
   Nella scheda «Porte»:
     1. se manca la riga 4000: «Aggiungi porta» → scrivi 4000 → Invio
     2. sulla riga 4000: clic destro (su iPad: tieni premuto) → «Visibilità porta» → «Public»
   Poi rilancia: bash .devcontainer/mobile.sh

MSG
    exit 1
  elif [ "$STATUS" != "200" ]; then
    echo ""
    echo "⚠  La porta 4000 è pubblica, ma l'API non risponde (${STATUS}). Ultime righe del suo log:"
    echo ""
    tail -n 15 /tmp/maestranze-api.log 2>/dev/null || echo "   (nessun log: l'API non è mai partita)"
    echo ""
    echo "   Riavvia tutto con: bash .devcontainer/start.sh   poi, dopo un minuto: bash .devcontainer/mobile.sh"
    exit 1
  fi
fi

echo ""
echo "App per Expo Go — API: ${API_URL}"
echo "Sull'iPhone: installa «Expo Go» dall'App Store, poi inquadra il QR code qui sotto con la Fotocamera."
echo ""
cd apps/mobile
# Tunnel: quello di Expo se c'è un account collegato (npx expo login), altrimenti ngrok, che non lo richiede.
if npx expo whoami >/dev/null 2>&1; then
  TUNNEL=(--tunnel)
else
  TUNNEL=(--tunnel ngrok)
  echo "(Tunnel ngrok. Se non si apre: crea un account gratuito su expo.dev, esegui «npx expo login»"
  echo " nella cartella apps/mobile e rilancia questo script.)"
  echo ""
fi
EXPO_PUBLIC_API_URL="$API_URL" exec npx expo start --go "${TUNNEL[@]}"
