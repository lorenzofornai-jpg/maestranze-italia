#!/usr/bin/env bash
# Preparazione del Codespace (una volta, alla creazione): dipendenze, configurazione, database, dati di prova.
set -euo pipefail
cd "$(dirname "$0")/.."

corepack enable >/dev/null 2>&1 || sudo corepack enable
corepack install >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

ENV=apps/api/.env
if [ ! -f "$ENV" ]; then
  cp apps/api/.env.example "$ENV"
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  sed -i "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=${KEY}|" "$ENV"
fi
# Nel Codespace database e posta sono servizi a parte (vedi docker-compose.yml).
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL:-postgres://maestranze:maestranze@db:5432/maestranze}|" "$ENV"
sed -i "s|^SMTP_URL=.*|SMTP_URL=${SMTP_URL:-smtp://mailpit:1025}|" "$ENV"

echo "Attendo il database…"
for _ in $(seq 1 60); do
  node -e "const c=new (require('./apps/api/node_modules/pg').Client)({connectionString:process.argv[1]});c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1))" "$(grep ^DATABASE_URL= "$ENV" | cut -d= -f2-)" && break
  sleep 2
done

pnpm db:migrate
pnpm --filter @maestranze/api db:seed
