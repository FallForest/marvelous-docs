# Build from the repository root so the script path resolves:
#   docker build -f apps/updater/Dockerfile -t marvelous-docs-updater:local .
#
# The agent is a single file with no dependencies, so there is no install step:
# the image only needs an HTTP runtime plus the docker CLI it shells out to.
FROM node:22-alpine
RUN apk add --no-cache bash docker-cli docker-cli-compose
WORKDIR /app
COPY apps/updater/update-agent.mjs ./update-agent.mjs
CMD ["node", "update-agent.mjs"]
