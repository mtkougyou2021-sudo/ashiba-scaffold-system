FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN ./node_modules/.bin/prisma generate
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Tokyo
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN ./node_modules/.bin/prisma generate
COPY --from=build /app/dist ./dist
COPY src/views ./src/views
COPY public ./public
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node dist/scripts/seed.js && node dist/src/index.js"]
