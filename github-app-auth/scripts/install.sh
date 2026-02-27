#! /bin/bash

current_dir=$(dirname "$0")

cat << EOF > $current_dir/private-key.pem
${GITHUB_APP_PRIVATE_KEY}
EOF
unset GITHUB_APP_PRIVATE_KEY

# Snapshot the current environment so the cron job can source it reliably.
# /proc/1/environ is not always readable from cron (permissions / namespace).
cat << EOF > $current_dir/.env
GITHUB_AUTH_APP_DIR=${current_dir}
GITHUB_APP_ID=${GITHUB_APP_ID}
GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID}
GITHUB_APP_PRIVATE_KEY_PATH=${GITHUB_APP_PRIVATE_KEY_PATH}
OPENCLAW_STATE_DIR=${OPENCLAW_STATE_DIR}
EOF

unset GITHUB_APP_PRIVATE_KEY_PATH
unset GITHUB_APP_INSTALLATION_ID
unset GITHUB_APP_ID

cron
echo "[entrypoint] cron started"
