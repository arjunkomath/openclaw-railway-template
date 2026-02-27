cat << 'EOF' > /data/private/github-app-auth/token-refresh.sh
#! /bin/bash

set -euo pipefail

if [ -z "$GITHUB_APP_ID" ]; then
  echo "GITHUB_APP_ID must be set"
  exit 1
fi

if [ -z "$GITHUB_APP_INSTALLATION_ID" ]; then
  echo "GITHUB_APP_INSTALLATION_ID must be set"
  exit 1
fi

if [ -z "$GITHUB_APP_PRIVATE_KEY_PATH" ]; then
  echo "GITHUB_APP_PRIVATE_KEY_PATH must be set"
  exit 1
fi

now=$(date +%s)
iat=$((now - 60))
exp=$((now + 540))  # keep < 10 minutes

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

header='{"alg":"RS256","typ":"JWT"}'
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$iat" "$exp" "$GITHUB_APP_ID")

unsigned="$(printf '%s' "$header" | b64url).$(printf '%s' "$payload" | b64url)"
sig="$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign "$GITHUB_APP_PRIVATE_KEY_PATH" | b64url)"
jwt="$unsigned.$sig"

token=$(
  curl -sS -X POST \
    -H "Authorization: Bearer $jwt" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/app/installations/$GITHUB_APP_INSTALLATION_ID/access_tokens" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["token"])'
)

export GH_TOKEN="$token"

if ! grep -q "GH_TOKEN=" $OPENCLAW_STATE_DIR/.env; then
  echo "GH_TOKEN=$token" >> $OPENCLAW_STATE_DIR/.env
else
  sed -i "s|GH_TOKEN=.*|GH_TOKEN=$token|" $OPENCLAW_STATE_DIR/.env
fi

echo "Minted installation token; GH_TOKEN set."
EOF