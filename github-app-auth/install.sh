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

cron
echo "[entrypoint] cron started"