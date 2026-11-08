# syntax=docker/dockerfile:1

FROM node:20-alpine AS web-build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/index.html apps/web/vite.config.ts apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared/src packages/shared/src
COPY apps/web/src apps/web/src
RUN pnpm --filter @meetcon/shared run build \
  && pnpm --filter @meetcon/web run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 30098
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
  CMD wget -qO- --no-check-certificate https://127.0.0.1:30098/health || exit 1
