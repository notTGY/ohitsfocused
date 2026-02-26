FROM oven/bun:1.2.15-alpine AS frontend-stage
WORKDIR /app

COPY . .
RUN bun i && bun run build

FROM nginx

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-stage /app/dist /usr/share/nginx/html
