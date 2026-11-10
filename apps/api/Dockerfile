# syntax=docker/dockerfile:1
# Production API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile .
# Local development does not run this image. `node run.mjs` starts the API on the host.

FROM node:20-alpine AS build
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache python3 make g++ git
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@meetcon/api..."
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
# pnpm 10 deploy needs --legacy unless workspace packages are injected.
RUN pnpm --filter @meetcon/shared run build \
  && pnpm --filter @meetcon/api run build \
  && mkdir -p apps/api/dist/db \
  && cp -r apps/api/src/db/migrations apps/api/dist/db/migrations \
  && pnpm --filter @meetcon/api deploy --legacy --prod /out

FROM node:20-alpine AS runtime
RUN addgroup -S meetcon && adduser -S meetcon -G meetcon
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=meetcon:meetcon /out ./
RUN mkdir -p /data/media && chown -R meetcon:meetcon /data/media
USER meetcon
EXPOSE 3001
ARG MEETCON_IMAGE_TAG=production
ARG MEETCON_RUNTIME=production
LABEL org.opencontainers.image.title="meetcon-api" \
      org.opencontainers.image.version="${MEETCON_IMAGE_TAG}" \
      meetcon.runtime="${MEETCON_RUNTIME}"
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
