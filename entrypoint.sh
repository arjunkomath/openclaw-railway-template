#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

# ensure /data/credentials exists and is only accessible by root
if [ ! -d /data/credentials ]; then
  mkdir -p /data/credentials
fi
chown root:root /data/credentials
chmod 700 /data/credentials

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

exec gosu openclaw node src/server.js
