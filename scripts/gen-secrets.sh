#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Generate strong secrets into .env for a PulseDeck deployment.
#
#   ./scripts/gen-secrets.sh        (or: make setup)
#
# Idempotent and non-destructive: a secret is generated ONLY when it is missing,
# empty, or still a known dev placeholder. Real values you have already set are
# left untouched, so re-running is always safe (it just fills any gaps).
#
# To ROTATE a secret: blank its line in .env (KEY=) and re-run this script, or
# replace the value by hand — then restart the API.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
EXAMPLE_FILE="$ROOT/.env.example"

# Values matching this are treated as non-secret placeholders and replaced.
# Keep in sync with PLACEHOLDER_SECRET_RE in apps/api/src/env.ts.
PLACEHOLDER_RE='change-?me|insecure|dev-only|placeholder|secret-string|example'

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl is required to generate secrets but was not found." >&2
  exit 1
fi

gen_secret() { openssl rand -base64 48 | tr -d '\n'; }

# upsert_secret KEY — set KEY in .env to a fresh secret, but only if it is
# currently absent / empty / a placeholder. Otherwise leave it as-is.
upsert_secret() {
  local key="$1" current generated tmp
  generated="$(gen_secret)"

  if grep -qE "^${key}=" "$ENV_FILE"; then
    current="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
    if [ -n "$current" ] && ! printf '%s' "$current" | grep -qiE "$PLACEHOLDER_RE"; then
      echo "  $key: already set — left unchanged"
      return
    fi
    # Replace in place. awk (not sed) so the base64 value's / and + are literal.
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$generated" '
      BEGIN { FS = "=" }
      $1 == k { print k "=" v; replaced = 1; next }
      { print }
      END { if (!replaced) print k "=" v }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
    echo "  $key: generated (replaced placeholder)"
  else
    printf '%s=%s\n' "$key" "$generated" >> "$ENV_FILE"
    echo "  $key: generated (appended)"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

echo "Filling secrets in .env:"
upsert_secret AUTH_SECRET
# Future secrets (e.g. POSTGRES_PASSWORD) are added here as they are introduced.

echo
echo "Done."
echo "  - .env is gitignored — never commit it."
echo "  - Production also needs NODE_ENV=production (the prod compose sets this)."
echo "  - Rotate a secret: blank its line (KEY=) and re-run, then restart the API."
