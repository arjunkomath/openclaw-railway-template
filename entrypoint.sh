#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

TS_DIR=/data/tailscale
mkdir -p "$TS_DIR"
chown -R root:root "$TS_DIR"
chmod 700 "$TS_DIR"

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

start_tailscale() {
  if ! command -v tailscaled >/dev/null 2>&1; then
    echo "[tailscale] tailscaled binary not present, skipping"
    return 0
  fi

  echo "[tailscale] starting tailscaled (userspace networking)"
  tailscaled \
    --state="$TS_DIR/tailscaled.state" \
    --socket="$TS_DIR/tailscaled.sock" \
    --tun=userspace-networking \
    --socks5-server=localhost:1055 \
    --outbound-http-proxy-listen=localhost:1055 \
    >>"$TS_DIR/tailscaled.log" 2>&1 &

  local i
  for i in $(seq 1 30); do
    [ -S "$TS_DIR/tailscaled.sock" ] && break
    sleep 1
  done

  if [ ! -S "$TS_DIR/tailscaled.sock" ]; then
    echo "[tailscale] tailscaled did not become ready; last log lines:"
    tail -n 20 "$TS_DIR/tailscaled.log" 2>/dev/null || true
    return 0
  fi

  if [ -n "${TS_AUTHKEY:-}" ]; then
    local hostname="${TS_HOSTNAME:-openclaw-railway}"
    echo "[tailscale] tailscale up (hostname=$hostname)"
    if tailscale --socket="$TS_DIR/tailscaled.sock" up \
        --authkey="$TS_AUTHKEY" \
        --hostname="$hostname" \
        --accept-dns="${TS_ACCEPT_DNS:-false}" \
        ${TS_EXTRA_ARGS:-}; then
      echo "[tailscale] authenticated successfully"
    else
      echo "[tailscale] tailscale up failed; check $TS_DIR/tailscaled.log"
      return 0
    fi

    if [ "${TS_SERVE_DISABLED:-false}" != "true" ]; then
      local serve_port="${TS_SERVE_PORT:-${PORT:-8080}}"
      echo "[tailscale] tailscale serve -> http://localhost:$serve_port"
      tailscale --socket="$TS_DIR/tailscaled.sock" serve reset 2>/dev/null || true
      tailscale --socket="$TS_DIR/tailscaled.sock" serve --bg \
        "http://localhost:$serve_port" \
        || echo "[tailscale] serve failed (node still reachable on tailnet IP:$serve_port)"
    fi

    tailscale --socket="$TS_DIR/tailscaled.sock" status --peers=false 2>/dev/null || true
  else
    echo "[tailscale] TS_AUTHKEY not set; daemon running but node is unauthenticated"
    echo "[tailscale] set TS_AUTHKEY in Railway service variables and redeploy"
  fi
}

start_tailscale

exec gosu openclaw node src/server.js
