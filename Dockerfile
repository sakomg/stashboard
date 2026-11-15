FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY assets.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets
RUN mkdir -p /data && chown node:node /data

USER node
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
CMD ["src/main.ts"]
