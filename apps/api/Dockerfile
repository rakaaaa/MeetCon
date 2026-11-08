# syntax=docker/dockerfile:1
# Build from repository root:
#   docker build -f apps/api/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
RUN pnpm --filter @meetcon/shared run build \
  && pnpm --filter @meetcon/api run build \
  && cp -r apps/api/src/db/migrations apps/api/dist/db/migrations

FROM node:20-alpine AS runtime
RUN addgroup -S meetcon && adduser -S meetcon -G meetcon
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api ./apps/api
RUN mkdir -p /data/media && chown -R meetcon:meetcon /data/media
USER meetcon
WORKDIR /repo/apps/api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
