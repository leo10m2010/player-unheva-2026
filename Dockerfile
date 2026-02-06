FROM node:18-bullseye AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production

FROM node:18-bullseye-slim
RUN apt-get update \
  && apt-get install -y ffmpeg wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
