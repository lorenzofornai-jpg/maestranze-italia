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
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API_URL/health")
  if [ "$STATUS" != "200" ]; then
    cat <<MSG

⚠  Il telefono non raggiunge ancora l'API (${API_URL} → ${STATUS}).
   Nella scheda «Porte»:
     1. se manca la riga 4000: «Aggiungi porta» → scrivi 4000 → Invio
     2. clic destro sulla riga 4000 → «Visibilità porta» → «Public»
   Poi rilancia: bash .devcontainer/mobile.sh

MSG
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
