#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

# Keep the persistent procurement plugin synchronized with the version built
# into this image. Copy runtime dependencies too; the plugin imports typebox.
if [ -d /data/.openclaw/extensions/procurement-tools ]; then
  rm -rf /data/.openclaw/extensions/procurement-tools/dist
  rm -rf /data/.openclaw/extensions/procurement-tools/node_modules
  cp -a /app/plugins/procurement-tools/dist /data/.openclaw/extensions/procurement-tools/dist
  cp -a /app/plugins/procurement-tools/node_modules /data/.openclaw/extensions/procurement-tools/node_modules
  cp /app/plugins/procurement-tools/package.json /data/.openclaw/extensions/procurement-tools/package.json
  if [ -f /app/plugins/procurement-tools/openclaw.plugin.json ]; then
    cp /app/plugins/procurement-tools/openclaw.plugin.json /data/.openclaw/extensions/procurement-tools/openclaw.plugin.json
  fi
  chown -R openclaw:openclaw /data/.openclaw/extensions/procurement-tools
fi

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

exec gosu openclaw node src/server.js
