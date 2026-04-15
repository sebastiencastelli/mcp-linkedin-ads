#!/usr/bin/env bash
#
# generate-secrets.sh — bootstrap an .env file for the MCP LinkedIn Ads server.
#
# Generates two random secrets (MCP_API_TOKEN and ENCRYPTION_KEY) and prompts
# for the LinkedIn Developer App credentials and the public domain. Writes
# the result to docker/.env. Idempotent: refuses to overwrite an existing
# .env unless --force is passed.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="${SCRIPT_DIR}/../docker/.env"

force=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--force]

Bootstrap docker/.env with random secrets and prompted credentials.

Options:
  --force   Overwrite an existing docker/.env file.
EOF
      exit 0
      ;;
  esac
done

if [[ -f "$ENV_FILE" && "$force" != true ]]; then
  echo "ERROR: $ENV_FILE already exists. Use --force to overwrite." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate secrets." >&2
  exit 1
fi

mcp_token=$(openssl rand -hex 32)
encryption_key=$(openssl rand -hex 32)

echo "Generating .env at $ENV_FILE"
echo
read -rp "LinkedIn Client ID:     " linkedin_client_id
read -rp "LinkedIn Client Secret: " linkedin_client_secret
read -rp "Public domain (e.g. mcp.example.com): " domain
read -rp "Log level [info]:       " log_level
log_level=${log_level:-info}

cat > "$ENV_FILE" <<EOF
# Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ") by generate-secrets.sh
LINKEDIN_CLIENT_ID=${linkedin_client_id}
LINKEDIN_CLIENT_SECRET=${linkedin_client_secret}
PUBLIC_URL=https://${domain}
DOMAIN=${domain}
MCP_API_TOKEN=${mcp_token}
ENCRYPTION_KEY=${encryption_key}
LOG_LEVEL=${log_level}
EOF

chmod 600 "$ENV_FILE"

cat <<EOF

Done. Wrote $ENV_FILE (mode 600).

NEXT STEPS:
  1. In the LinkedIn Developer Portal (https://www.linkedin.com/developers/apps),
     open your app → Auth tab → "Authorized redirect URLs for your app" and
     add:

         https://${domain}/oauth/callback

  2. Make sure your DNS for ${domain} points to this server before starting
     Caddy (otherwise Let's Encrypt cert issuance will fail).

  3. Start the stack:

         cd $(dirname "$ENV_FILE") && docker compose up -d

  4. Open https://${domain}/setup in your browser. Paste the API token below
     to log in, then click "Connecter LinkedIn":

         API token: ${mcp_token}

EOF
