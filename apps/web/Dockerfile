# Build from the repository root so the pnpm workspace and lockfile are in scope:
#   docker build -f apps/web/Dockerfile -t marvelous-docs-web:local .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG VITE_API_URL=""
ARG VITE_COLLAB_URL=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_COLLAB_URL=$VITE_COLLAB_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN pnpm install --frozen-lockfile --filter @marvelous-docs/web...
COPY apps/web/tsconfig.json apps/web/index.html apps/web/vite.config.ts apps/web/
COPY apps/web/public apps/web/public
COPY apps/web/src apps/web/src
RUN pnpm --filter @marvelous-docs/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
