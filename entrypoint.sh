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

export GITHUB_AUTH_APP_DIR=$PRIVATE_DIR/github-app-auth
mkdir -p $GITHUB_AUTH_APP_DIR
cp -r /app/github-app-auth $GITHUB_AUTH_APP_DIR/

ls -la $GITHUB_AUTH_APP_DIR
$GITHUB_AUTH_APP_DIR/install.sh


exec gosu openclaw node src/server.js
