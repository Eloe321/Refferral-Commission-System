FROM node:24.15.0-alpine AS dependencies

RUN corepack enable
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG API_PROXY_TARGET=http://api:4000
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui
RUN pnpm --filter @referral-sandbox/web build

FROM node:24.15.0-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
