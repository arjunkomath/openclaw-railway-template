#!/bin/bash
set -e


chown -R openclaw:openclaw /data
chmod 700 /data

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi
# ensure /data/credentials exists and is only accessible by root
if [ ! -d /data/credentials ]; then
  mkdir -p /data/credentials
fi
chown root:root /data/credentials
chmod 700 /data/credentials


rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

# --- cron setup (persistent crontab on /data volume) ---
CRONTAB_FILE="/data/crontab"
if [ ! -f "$CRONTAB_FILE" ]; then
  printf "# Persistent crontab for root – edits survive redeployments\n# Example: run a script every day at 3 AM UTC\n# 0 3 * * * /home/linuxbrew/.linuxbrew/bin/brew update >/dev/null 2>&1\n# GitHub skill token refresh (every 45 mins)\n*/5 * * * * $OPENCLAW_WORKSPACE_DIR/skills/github-app-auth/scripts/token-refresh.sh\n" > "$CRONTAB_FILE"
  chown root:root "$CRONTAB_FILE"
fi
crontab "$CRONTAB_FILE"
cron
echo "[entrypoint] cron started (crontab loaded from $CRONTAB_FILE)"

exec gosu openclaw node src/server.js
