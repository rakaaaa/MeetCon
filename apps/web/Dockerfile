# syntax=docker/dockerfile:1
# Build from repository root:
#   docker build -f apps/web/Dockerfile .
# Static web assets only (reference / split deployments).
# Production website stack uses deploy/gateway/Dockerfile on port 30098.

FROM node:20-alpine AS build
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
COPY deploy/nginx-static.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
