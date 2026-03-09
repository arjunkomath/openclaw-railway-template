#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

PRIVATE_DIR=/data/private
# ensure /data/private exists and is only accessible by root
mkdir -p $PRIVATE_DIR
chown root:root $PRIVATE_DIR
chmod 700 $PRIVATE_DIR

/root/github-app-auth/install.sh
openclaw config set gateway.controlUi.allowedOrigins "[\"http://localhost:8080\",\"http://127.0.0.1:8080\",\"https://${RAILWAY_PUBLIC_DOMAIN}\"]"
exec su-exec openclaw node src/server.js
