#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

# Keep the installed procurement plugin runtime synchronized with the version
# shipped in this deployment. Plugin installation metadata stays on /data,
# while the executable entry is refreshed from the GitHub-built image.
if [ -f /data/.openclaw/extensions/procurement-tools/dist/index.js ]; then
  cp /app/plugins/procurement-tools/dist/index.js /data/.openclaw/extensions/procurement-tools/dist/index.js
  chown openclaw:openclaw /data/.openclaw/extensions/procurement-tools/dist/index.js
fi

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

exec gosu openclaw node src/server.js
