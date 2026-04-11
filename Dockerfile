# Stage 1: builder — компилируем всё
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 2: runner — только production артефакты
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/prisma ./prisma
# Копируем скомпилированную библиотеку для driverAuth (нужна в server.js)
COPY --from=builder /app/src/lib/driverAuth.js ./src/lib/driverAuth.js
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
