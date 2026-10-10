FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/theme/package.json packages/theme/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @fnb/admin...
COPY packages packages
COPY apps/admin apps/admin
RUN pnpm --filter @fnb/shared build && pnpm --filter @fnb/admin build

FROM nginx:1.27-alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
