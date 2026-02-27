#!/bin/bash
set -e

echo "OPENCLAW_STATE_DIR: $OPENCLAW_STATE_DIR"

chown -R openclaw:openclaw /data
chmod 700 /data

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

# ensure /data/private exists and is only accessible by root
mkdir -p /data/private
chown root:root /data/private
chmod 700 /data/private

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

cron
echo "[entrypoint] cron started"

exec gosu openclaw node src/server.js
