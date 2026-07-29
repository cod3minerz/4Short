FROM node:22.21.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY db ./db
COPY packages ./packages
COPY services/control-api ./services/control-api
RUN npm run build:api

FROM node:22.21.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/services/control-api/dist ./services/control-api/dist
COPY drizzle ./drizzle
COPY infra/certs/timeweb-cloud-root.crt /tmp/timeweb-cloud-root.crt
RUN install -o root -g root -m 0444 \
      /tmp/timeweb-cloud-root.crt \
      /etc/ssl/certs/timeweb-cloud-root.crt \
    && rm /tmp/timeweb-cloud-root.crt
USER node
EXPOSE 4100
CMD ["node", "services/control-api/dist/services/control-api/src/server.js"]
