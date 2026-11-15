FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATA_DIR=/data

# Node 24 runs TypeScript directly, so there is no build step. The config is mounted from the host.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY assets.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets
RUN mkdir -p /data && chown node:node /data

USER node
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
# Other entry points run the same way: docker compose run --rm stashboard src/check.ts
CMD ["src/server.ts"]
