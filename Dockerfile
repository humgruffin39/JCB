FROM node:24.18.0-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jcb/server build

FROM node:24.18.0-bookworm-slim AS runtime

ARG TARGETARCH=amd64
ARG LITESTREAM_VERSION=0.5.15
WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl gosu \
    && case "${TARGETARCH}" in \
         amd64) litestream_arch="x86_64" ;; \
         arm64) litestream_arch="arm64" ;; \
         *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && archive="litestream-${LITESTREAM_VERSION}-linux-${litestream_arch}.tar.gz" \
    && curl --fail --location --silent --show-error \
         --output "/tmp/${archive}" \
         "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/${archive}" \
    && curl --fail --location --silent --show-error \
         --output /tmp/checksums.txt \
         "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/checksums.txt" \
    && cd /tmp \
    && grep " ${archive}$" checksums.txt | sha256sum --check --strict \
    && tar -xzf "${archive}" \
    && install -m 0755 litestream /usr/local/bin/litestream \
    && rm -f "/tmp/${archive}" /tmp/checksums.txt /tmp/litestream \
    && apt-get purge --yes --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY package.json ./package.json
COPY apps/server/package.json ./apps/server/package.json
COPY packages/database/migrations ./packages/database/migrations
COPY deploy/litestream.yml /etc/litestream.template.yml
COPY deploy/entrypoint.sh /usr/local/bin/jcb-entrypoint
COPY scripts/restore-backup.sh scripts/restore-drill.sh ./scripts/

RUN chmod 0755 /usr/local/bin/jcb-entrypoint ./scripts/restore-backup.sh ./scripts/restore-drill.sh \
    && mkdir -p /data \
    && chown -R node:node /app /data

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/jcb-entrypoint"]
