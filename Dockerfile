# SafeRaah server + web app, ready for Google Cloud Run.
#   docker build -t saferaah .
#   docker run -p 8080:8080 -e GEMINI_API_KEY=... saferaah
# Keys (GEMINI_API_KEY, GOOGLE_AIR_KEY) are passed at run time, never baked into the image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=web/dist DB_PATH=/tmp/saferaah.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save tsx@4
COPY server ./server
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8080
CMD ["npx", "tsx", "server/main.ts"]
