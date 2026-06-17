# ---- Stage 1: Build web (React → dist/) ----
FROM node:22-alpine AS web-builder

WORKDIR /app

COPY web/package.json ./web/
RUN cd web && npm install

COPY web/ ./web/
RUN cd web && npm run build

# ---- Stage 2: Install server dependencies ----
FROM node:22-alpine AS server-builder

WORKDIR /app

COPY server/package.json ./
RUN npm install

# ---- Stage 3: Runtime (leve, sem npm) ----
FROM node:22-alpine

RUN apk update && apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app

COPY --from=server-builder /app/node_modules ./node_modules
COPY .env ./
COPY server/ ./
COPY --from=web-builder /app/web/dist /web/dist

VOLUME ["/data"]

EXPOSE 4000

ENV NODE_ENV=production

CMD ["node", "node_modules/.bin/tsx", "src/index.ts"]
