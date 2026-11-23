# syntax=docker/dockerfile:1
#
# Build context is the REPO ROOT, not backend/ (see `build.context: .` in
# ../docker-compose.yml): the backend is an npm workspace and imports
# @globe-wallet/sdk, the generated contract bindings and
# @stellar-global-wallet/types from packages/.

FROM node:26-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY backend/package.json ./backend/package.json
RUN npm ci

# The backend loads the SDK and bindings from their dist/ output.
RUN npm run build:packages

COPY backend ./backend
RUN npm run build --workspace backend

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages ./packages
COPY backend/package.json ./backend/package.json
RUN npm ci --omit=dev

COPY --from=build /app/packages/bindings/globe-wallet/dist ./packages/bindings/globe-wallet/dist
COPY --from=build /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build /app/backend/dist ./backend/dist
# Curated verified-asset lists (#54), read at runtime from backend/data.
COPY backend/data ./backend/data
# Served at /api/openapi.json and /api/docs when ENABLE_API_DOCS=true (#16).
COPY backend/openapi.yaml ./backend/openapi.yaml

EXPOSE 4000
CMD ["node", "backend/dist/index.js"]
