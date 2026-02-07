FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --chown=node:node . .
RUN mkdir -p /app/uploads /app/thumbnails /app/hls /app/data /app/logs \
  && chown -R node:node /app
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
