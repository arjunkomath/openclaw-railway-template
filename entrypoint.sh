#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

# --- cron setup (persistent crontab on /data volume) ---
CRONTAB_FILE="/data/crontab"
if [ ! -f "$CRONTAB_FILE" ]; then
  printf "# Persistent crontab for openclaw user – edits survive redeployments\n# Example: run a script every day at 3 AM UTC\n# 0 3 * * * /home/linuxbrew/.linuxbrew/bin/brew update >/dev/null 2>&1\n" > "$CRONTAB_FILE"
  chown openclaw:openclaw "$CRONTAB_FILE"
fi
crontab -u openclaw "$CRONTAB_FILE"
cron
echo "[entrypoint] cron started (crontab loaded from $CRONTAB_FILE)"

exec gosu openclaw node src/server.js
