FROM node:22-alpine
RUN apk add --no-cache bash docker-cli docker-cli-compose
WORKDIR /app
COPY scripts/update-agent.mjs ./update-agent.mjs
CMD ["node", "update-agent.mjs"]
