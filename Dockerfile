FROM node:26-bookworm

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gosu \
    procps \
    python3 \
    tini \
    build-essential \
    zip \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
    --allow-scripts=openclaw \
    openclaw@2026.11.3 \
  && node --version | grep -Eq '^v26\.' \
  && openclaw --version | grep -Eq '^OpenClaw 2026\.11\.3( |$)'
RUN npm install -g clawhub@latest

# gog: Google Workspace CLI used by OpenClaw's bundled `gog` skill (Gmail read/send)
ARG GOG_VERSION=0.48.1
ARG TARGETARCH
RUN set -eu; \
  arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
  case "$arch" in \
    amd64) sha=dcd956e09d1222a07c1304d836f8acd55266b2fa241ef466580ced6a02453d72 ;; \
    arm64) sha=c091fa2014dc3d5608acef4d09fb3bb4a3eb71e4cff898b5eaddd9703599e45c ;; \
    *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  tarball="gogcli_${GOG_VERSION}_linux_${arch}.tar.gz"; \
  curl -fsSL -o "/tmp/$tarball" "https://github.com/steipete/gogcli/releases/download/v${GOG_VERSION}/$tarball"; \
  echo "$sha  /tmp/$tarball" | sha256sum -c -; \
  mkdir /tmp/gog; \
  tar -xzf "/tmp/$tarball" -C /tmp/gog; \
  install -m 755 /tmp/gog/gog /usr/local/bin/gog; \
  rm -rf "/tmp/$tarball" /tmp/gog; \
  gog --version

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@11.24.0 \
  && pnpm install --frozen-lockfile --prod

COPY src ./src
COPY --chmod=755 entrypoint.sh ./entrypoint.sh

RUN useradd -m -s /bin/bash openclaw \
  && chown -R openclaw:openclaw /app \
  && mkdir -p /data && chown openclaw:openclaw /data \
  && mkdir -p /home/linuxbrew/.linuxbrew && chown -R openclaw:openclaw /home/linuxbrew

USER openclaw
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/home/linuxbrew/.linuxbrew"
ENV HOMEBREW_CELLAR="/home/linuxbrew/.linuxbrew/Cellar"
ENV HOMEBREW_REPOSITORY="/home/linuxbrew/.linuxbrew/Homebrew"

ENV GOG_HOME=/data/.gogcli
ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
ENV OPENCLAW_SUPERVISOR_MODE=external
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/setup/healthz || exit 1

USER root
ENTRYPOINT ["tini", "--", "./entrypoint.sh"]
