FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

VOLUME ["/data"]

EXPOSE 4000

CMD ["node", "node_modules/.bin/tsx", "src/index.ts"]
