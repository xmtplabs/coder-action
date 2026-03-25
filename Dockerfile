FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Build
FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY tsconfig.json ./
RUN bun build src/main.ts --outfile dist/server.js --target bun --external pino --external pino-pretty

# Runtime
FROM base AS runtime
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/dist/server.js dist/server.js

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://localhost:3000/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "run", "dist/server.js"]
