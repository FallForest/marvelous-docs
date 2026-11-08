# Build from the repository root so the pnpm workspace and lockfile are in scope:
#   docker build -f apps/server/Dockerfile -t marvelous-docs-api:local .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable
WORKDIR /repo

# Only the manifests, so the dependency layer survives source changes.
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/cli/package.json packages/cli/package.json

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter @marvelous-docs/server...
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/server/migrations apps/server/migrations
RUN pnpm --filter @marvelous-docs/server build
# Production-only, self-contained node_modules plus the compiled package.
# --legacy is required because the workspace does not set inject-workspace-packages.
RUN pnpm --filter @marvelous-docs/server deploy --prod --legacy /app \
 && rm -rf /app/src /app/test /app/tsconfig.json /app/Dockerfile /app/README.md /app/.env.example

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
COPY --from=build /repo/apps/server/migrations ./migrations
RUN mkdir -p /data/uploads
EXPOSE 3000 1234
CMD ["node", "dist/index.js"]
