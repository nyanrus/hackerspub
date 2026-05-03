# --- Builder stage ---------------------------------------------------------
FROM docker.io/debian:13-slim AS builder

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get -y --no-install-recommends install \
  build-essential ca-certificates curl ffmpeg jq && \
  rm -rf /var/lib/apt/lists/*

ENV MISE_DATA_DIR="/mise"
ENV MISE_CONFIG_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
ENV PATH="/mise/shims:$PATH"

RUN curl https://mise.run | sh

WORKDIR /app
COPY mise.toml /app/mise.toml
RUN mise trust && mise install

COPY web/fonts /app/web/fonts

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml /app/
COPY deno.json /app/deno.json
COPY deno.lock /app/deno.lock
COPY ai/deno.json /app/ai/deno.json
COPY ai/package.json /app/ai/package.json
COPY federation/deno.json /app/federation/deno.json
COPY federation/package.json /app/federation/package.json
COPY graphql/deno.json /app/graphql/deno.json
COPY models/deno.json /app/models/deno.json
COPY models/package.json /app/models/package.json
COPY web/deno.json /app/web/deno.json
COPY web-next/deno.jsonc /app/web-next/deno.jsonc
COPY web-next/package.json /app/web-next/package.json
COPY patches /app/patches

RUN pnpm install --frozen-lockfile
RUN deno install

COPY . /app
RUN cp .env.sample .env && \
  sed -i '/^INSTANCE_ACTOR_KEY=/d' .env && \
  echo >> .env && \
  echo "INSTANCE_ACTOR_KEY='$(mise run keygen)'" >> .env && \
  deno task -r codegen && \
  deno task build && \
  pnpm --filter @hackerspub/web-next build && \
  rm .env

ARG GIT_COMMIT
ENV GIT_COMMIT=${GIT_COMMIT}

RUN if [ -n "$GIT_COMMIT" ]; then \
  jq '.version += "+" + $git_commit' --arg git_commit "$GIT_COMMIT" federation/deno.json > /tmp/deno.json && \
  mv /tmp/deno.json federation/deno.json && \
  jq '.version += "+" + $git_commit' --arg git_commit "$GIT_COMMIT" graphql/deno.json > /tmp/deno.json && \
  mv /tmp/deno.json graphql/deno.json && \
  jq '.version += "+" + $git_commit' --arg git_commit "$GIT_COMMIT" models/deno.json > /tmp/deno.json && \
  mv /tmp/deno.json models/deno.json && \
  jq '.version += "+" + $git_commit' --arg git_commit "$GIT_COMMIT" web/deno.json > /tmp/deno.json && \
  mv /tmp/deno.json web/deno.json && \
  jq '.version += "+" + $git_commit' --arg git_commit "$GIT_COMMIT" web-next/package.json > /tmp/package.json && \
  mv /tmp/package.json web-next/package.json \
  ; fi

# Drop devDependencies from node_modules. A clean reinstall in --prod mode
# is more reliable than `pnpm prune --prod` against a workspace that's
# already had its devDependencies pulled (e.g. Storybook, relay-compiler,
# vite plugins). Run after web-next build because the build needs them.
RUN rm -rf node_modules web-next/node_modules && \
  pnpm install --frozen-lockfile --prod

# --- Runtime stage ---------------------------------------------------------
FROM docker.io/debian:13-slim

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Runtime needs ffmpeg (media processing) and ca-certificates (HTTPS).
# build-essential, curl, jq, etc. stay in the builder stage only.
RUN apt-get update && apt-get -y --no-install-recommends install \
  ca-certificates ffmpeg && \
  rm -rf /var/lib/apt/lists/*

ENV MISE_DATA_DIR="/mise"
ENV MISE_CONFIG_DIR="/mise"
ENV MISE_CACHE_DIR="/mise/cache"
ENV MISE_INSTALL_PATH="/usr/local/bin/mise"
ENV PATH="/mise/shims:$PATH"

# mise binary plus its data dir (tool installs, shims, trusted-config state).
COPY --from=builder /usr/local/bin/mise /usr/local/bin/mise
COPY --from=builder /mise /mise

# Deno keeps its module cache at $HOME/.cache/deno; ship it so the runtime
# doesn't need network access to resolve imports.
COPY --from=builder /root/.cache/deno /root/.cache/deno

WORKDIR /app
COPY --from=builder /app /app

# Re-trust the config in the runtime stage. mise stores trust state under
# the user's home (not MISE_DATA_DIR), and we don't carry that over.
RUN mise trust /app/mise.toml

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["mise", "run", "prod:hc:web"]
CMD ["mise", "run", "prod:web"]
