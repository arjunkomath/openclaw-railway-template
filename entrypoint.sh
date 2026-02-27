#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

PRIVATE_DIR=/data/private
# ensure /data/private exists and is only accessible by root
mkdir -p $PRIVATE_DIR
chown root:root $PRIVATE_DIR
chmod 700 $PRIVATE_DIR

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

GITHUB_AUTH_APP_DIR=$PRIVATE_DIR/github-app-auth
CRONTAB_FILE=/root/crontab
if [ -f $CRONTAB_FILE ]; then
  printf "* * * * * $GITHUB_AUTH_APP_DIR/token-refresh.sh >> $GITHUB_AUTH_APP_DIR/cron.log 2>&1 \n" > $CRONTAB_FILE
fi
crontab $CRONTAB_FILE
cron
echo "[entrypoint] cron started"

exec gosu openclaw node src/server.js
