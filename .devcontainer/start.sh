#!/usr/bin/env bash
# Avvio a ogni apertura del Codespace: API e sito in background. Log in /tmp/maestranze-*.log.
#   bash .devcontainer/start.sh        avvia (o riavvia)
#   bash .devcontainer/start.sh stop   ferma
cd "$(dirname "$0")/.."
ENV=apps/api/.env

stop() {
  pkill -f "tsx.*src/server.ts" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
}
stop
[ "${1:-}" = "stop" ] && { echo "Maestranze fermata."; exit 0; }

[ -f "$ENV" ] || bash .devcontainer/setup.sh

# Indirizzo pubblico del sito: nel Codespace è https://<nome>-3000.<dominio>, altrimenti localhost.
if [ -n "${CODESPACE_NAME:-}" ]; then
  ORIGIN="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  ORIGIN="http://localhost:3000"
fi
sed -i "s|^WEB_ORIGIN=.*|WEB_ORIGIN=${ORIGIN}|" "$ENV"

pnpm db:migrate >/tmp/maestranze-migrate.log 2>&1

# setsid + nohup: i processi restano vivi quando il comando di avvio del Codespace termina.
setsid nohup bash -c "cd apps/api && exec pnpm start" >/tmp/maestranze-api.log 2>&1 < /dev/null &
# Versione ottimizzata del sito (compilata qui): più veloce da navigare della modalità di sviluppo.
setsid nohup bash -c "cd apps/web && NEXT_TELEMETRY_DISABLED=1 pnpm build >/tmp/maestranze-web-build.log 2>&1 && exec pnpm start" >/tmp/maestranze-web.log 2>&1 < /dev/null &

echo "Maestranze Italia si sta avviando su ${ORIGIN} (circa un minuto)."
echo "Codici SMS ed email di prova: scheda «Posta e SMS di prova» (porta 8025)."
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Ricerca in linguaggio naturale: LLM attivo (chiave ANTHROPIC_API_KEY trovata)."
else
  echo "Ricerca in linguaggio naturale: regole (nessuna ANTHROPIC_API_KEY; vedi docs/AVVIO-CODESPACES.md)."
fi
