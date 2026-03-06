#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

PRIVATE_DIR=/data/private
# ensure /data/private exists and is only accessible by root
mkdir -p $PRIVATE_DIR
chown root:root $PRIVATE_DIR
chmod 700 $PRIVATE_DIR

/root/github-app-auth/install.sh

exec su-exec openclaw node src/server.js
