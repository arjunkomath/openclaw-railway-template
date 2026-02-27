#! /bin/bash

cat << EOF > $GITHUB_AUTH_APP_DIR/private-key.pem
${GITHUB_APP_PRIVATE_KEY}
EOF

# Snapshot the current environment so the cron job can source it reliably.
# /proc/1/environ is not always readable from cron (permissions / namespace).
cat << EOF > $GITHUB_AUTH_APP_DIR/.env
GITHUB_AUTH_APP_DIR=${GITHUB_AUTH_APP_DIR}
GITHUB_APP_ID=${GITHUB_APP_ID}
GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID}
GITHUB_APP_PRIVATE_KEY_PATH=${GITHUB_APP_PRIVATE_KEY_PATH}
OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR}
EOF

cat << 'EOF' > $GITHUB_AUTH_APP_DIR/token-refresh.sh
#!/bin/bash

# Cron runs with a minimal environment; source saved env from install time.
set -a
source /data/private/github-app-auth/.env
set +a

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

chmod +x $GITHUB_AUTH_APP_DIR/token-refresh.sh


CRONTAB_FILE=/root/crontab
if [ -f $CRONTAB_FILE ]; then
  printf "* * * * * $GITHUB_AUTH_APP_DIR/token-refresh.sh >> /var/log/cron.log 2>&1 \n" > $CRONTAB_FILE
fi
crontab $CRONTAB_FILE
cron
echo "[entrypoint] cron started"