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

# High-entropy secret, any printable form (base64). Used for AUTH_SECRET.
gen_secret() { openssl rand -base64 48 | tr -d '\n'; }

# URL-safe secret (hex only) — safe to embed in a DATABASE_URL without escaping.
gen_url_safe() { openssl rand -hex 24 | tr -d '\n'; }

# Read the current value of KEY from .env (empty string if absent).
read_value() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true
}

# upsert_secret KEY [generator] [extra_weak_re] — set KEY in .env to a fresh
# secret, but only if it is currently absent / empty / a placeholder. Otherwise
# leave it as-is. generator defaults to gen_secret (pass gen_url_safe for
# URL-embedded values); extra_weak_re marks additional values as replaceable
# (e.g. the DB dev default `pulsedeck`, which is not a generic placeholder).
upsert_secret() {
  local key="$1" gen="${2:-gen_secret}" extra_re="${3:-}" current generated tmp weak
  generated="$("$gen")"

  if grep -qE "^${key}=" "$ENV_FILE"; then
    current="$(read_value "$key")"
    weak=0
    if [ -z "$current" ]; then
      weak=1
    elif printf '%s' "$current" | grep -qiE "$PLACEHOLDER_RE"; then
      weak=1
    elif [ -n "$extra_re" ] && printf '%s' "$current" | grep -qiE "$extra_re"; then
      weak=1
    fi
    if [ "$weak" -eq 0 ]; then
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

# Keep the bundled-Postgres dev password (.env DATABASE_URL) in step with a
# freshly generated POSTGRES_PASSWORD, so the non-Docker path stays consistent.
# Only touches the default `:pulsedeck@` password; a custom/external URL is left.
sync_database_url() {
  local newpw="$1" tmp
  grep -qE '^DATABASE_URL=' "$ENV_FILE" || return 0
  case "$(read_value DATABASE_URL)" in
    *://*:pulsedeck@*)
      tmp="$(mktemp)"
      awk -v pw="$newpw" '
        /^DATABASE_URL=/ {
          val = substr($0, length("DATABASE_URL=") + 1)
          gsub(/:pulsedeck@/, ":" pw "@", val)
          print "DATABASE_URL=" val
          next
        }
        { print }
      ' "$ENV_FILE" > "$tmp"
      mv "$tmp" "$ENV_FILE"
      echo "  DATABASE_URL: synced password to POSTGRES_PASSWORD"
      ;;
  esac
}

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

echo "Filling secrets in .env:"
upsert_secret AUTH_SECRET
upsert_secret POSTGRES_PASSWORD gen_url_safe '^(pulsedeck|postgres|password|root|admin|changeme)$'
sync_database_url "$(read_value POSTGRES_PASSWORD)"

echo
echo "Done."
echo "  - .env is gitignored — never commit it."
echo "  - Production also needs NODE_ENV=production (the prod compose sets this)."
echo "  - Rotate a secret: blank its line (KEY=) and re-run, then restart the API."
echo "  - POSTGRES_PASSWORD only initializes an EMPTY DB volume; to rotate an"
echo "    existing DB also run: ALTER USER pulsedeck PASSWORD '<new value>';"
