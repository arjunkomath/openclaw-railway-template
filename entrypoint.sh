#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

PLUGIN_DIR="/app/plugins/procurement-tools"
if ! gosu openclaw openclaw plugins inspect procurement-tools >/dev/null 2>&1; then
  echo "[entrypoint] installing MUAI procurement tools plugin..."
  gosu openclaw openclaw plugins install --link "$PLUGIN_DIR" --force
fi

exec gosu openclaw node src/server.js
