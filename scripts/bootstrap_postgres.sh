#!/usr/bin/env bash
set -euo pipefail

echo "[ReLoop Bootstrap] Ensuring PostgreSQL service is running..."
if command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo pg_ctlcluster 17 main status >/dev/null 2>&1 || sudo pg_ctlcluster 17 main start
fi

sudo -u postgres psql <<'EOF'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'reloop_admin') THEN
    CREATE ROLE reloop_admin WITH LOGIN PASSWORD 'reloop_secure_pass_2026' CREATEDB;
  END IF;
END
$$;
SELECT 'CREATE DATABASE reloop_db OWNER reloop_admin'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'reloop_db')\gexec
GRANT ALL PRIVILEGES ON DATABASE reloop_db TO reloop_admin;
EOF

npm run db:reset
echo "[ReLoop Bootstrap] Database migrated and seeded successfully!"
