FROM node:22-bookworm

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  gosu \
  procps \
  python3 \
  build-essential \
  zip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY src ./src
COPY entrypoint.sh ./entrypoint.sh

RUN useradd -m -s /bin/bash openclaw \
  && chown -R openclaw:openclaw /app \
  && mkdir -p /data && chown openclaw:openclaw /data \
  # important: keep credentials directory as root:root to avoid permission issues
  && mkdir -p /data/private && chown root:root /data/private && chmod 700 /data/private \
  && mkdir -p /data/private/github-app-auth \
  && mkdir -p /home/linuxbrew/.linuxbrew && chown -R openclaw:openclaw /home/linuxbrew

COPY github-app-auth/crontab /etc/cron.d/github-app-auth

USER openclaw
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/home/linuxbrew/.linuxbrew"
ENV HOMEBREW_CELLAR="/home/linuxbrew/.linuxbrew/Cellar"
ENV HOMEBREW_REPOSITORY="/home/linuxbrew/.linuxbrew/Homebrew"

ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/setup/healthz || exit 1

USER root
ENTRYPOINT ["./entrypoint.sh"]
