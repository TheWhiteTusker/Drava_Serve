FROM node:24-alpine
ENV TZ=Asia/Kolkata NODE_ENV=production
# pg_dump / pg_restore for the nightly backup and restore commands
RUN apk add --no-cache postgresql17-client
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY apps/api/package.json apps/api/
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter @fnb/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @fnb/shared build && pnpm --filter @fnb/api build
WORKDIR /app/apps/api
EXPOSE 3000
# Brings the control database and every customer database to the latest schema, seeds the
# SAMPLE demo customer only if there are no customers yet, then starts the API.
CMD ["sh", "-c", "node dist/cli.js seed-if-empty && node dist/main.js"]
