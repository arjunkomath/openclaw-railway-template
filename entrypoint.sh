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

/root/github-app-auth/install.sh

# Scrub sensitive GitHub App vars from the environment before handing off to
# the unprivileged node process.  install.sh already persisted everything it
# needs to root-owned files (private-key.pem, .env) so these are no longer
# required in memory.
unset GITHUB_APP_PRIVATE_KEY
unset GITHUB_APP_ID
unset GITHUB_APP_INSTALLATION_ID
unset GITHUB_APP_PRIVATE_KEY_PATH

exec gosu openclaw node src/server.js