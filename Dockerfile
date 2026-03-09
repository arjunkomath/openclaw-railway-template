FROM node:22-alpine

RUN apk add --no-cache \
  bash \
  ca-certificates \
  curl \
  git \
  su-exec \
  procps \
  python3 \
  build-base \
  zip \
  openssl \
  linux-headers \
  cmake

RUN npm install -g openclaw@2026.3.8

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src ./src
COPY --chmod=755 entrypoint.sh ./entrypoint.sh

RUN adduser -D -s /bin/bash openclaw \
  && chown -R openclaw:openclaw /app \
  && mkdir -p /data && chown openclaw:openclaw /data \
  # important: keep credentials directory as root:root to avoid permission issues
  && mkdir -p /data/private && chown root:root /data/private && chmod 700 /data/private

# Alpine uses busybox crond with /etc/crontabs/ (no username field in crontab)
COPY --chmod=640 github-app-auth/crontab.alpine /etc/crontabs/root
# Install github-app-auth scripts directly into /root/github-app-auth
COPY --chmod=700 github-app-auth/scripts /root/github-app-auth

ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/setup/healthz || exit 1

ENTRYPOINT ["./entrypoint.sh"]
