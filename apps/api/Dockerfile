FROM node:24-alpine AS dependencies

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

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/database packages/database
RUN pnpm --filter @referral-sandbox/api build \
  && pnpm --filter @referral-sandbox/api deploy --prod --legacy /opt/api

FROM node:24-alpine AS runtime

RUN corepack enable
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /opt/api ./

USER node
EXPOSE 4000

CMD ["sh", "-c", "node node_modules/@referral-sandbox/database/dist/migrate.js && node --input-type=module -e \"import { createDatabaseClient, ensureSandboxSeeded } from '@referral-sandbox/database'; const client=createDatabaseClient(process.env.DATABASE_URL,{max:1}); try { await ensureSandboxSeeded(client.db); } finally { await client.sql.end(); }\" && exec node dist/main.js"]
