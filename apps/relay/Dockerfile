# Build context must be the monorepo root:
#   fly deploy --config apps/relay/fly.toml --dockerfile apps/relay/Dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/relay/package.json apps/relay/
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile --filter @sideboard-ai/relay...

COPY packages/core packages/core
COPY apps/relay apps/relay

RUN pnpm --filter @sideboard-ai/core build \
 && pnpm --filter @sideboard-ai/relay build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/relay/package.json apps/relay/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/relay/dist apps/relay/dist
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/node_modules packages/core/node_modules
COPY --from=build /app/apps/relay/node_modules apps/relay/node_modules
COPY site /app/site

WORKDIR /app/apps/relay
EXPOSE 8080
CMD ["node", "dist/index.js"]
