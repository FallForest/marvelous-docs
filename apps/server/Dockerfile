FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY migrations ./migrations
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install --prod --no-frozen-lockfile
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 3000 1234
CMD ["node", "dist/index.js"]
