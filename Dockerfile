FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    CONFIG_PATH=/app/config.json \
    DATA_DIR=/data

# No runtime dependencies yet: Node 24 runs TypeScript directly. The config is mounted from the host.
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data

USER node
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
# Stage 0: key check. From stage 4 this starts the server.
CMD ["src/check.ts"]
