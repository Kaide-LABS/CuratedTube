# HalalTube — multi-stage image for Cloud Run (Next.js App Router, standalone output).
# deps -> build -> runner. The final image ships only the traced standalone server + static
# assets, runs as a non-root user, binds 0.0.0.0, and listens on $PORT (Cloud Run injects 8080).
# The YouTube API key is NEVER baked in — it is injected at runtime via a Secret Manager secret.

# 1) deps — install exactly from the lockfile.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) build — compile the standalone server (no API key needed; pages are dynamic, nothing
#    fetches at build time, so no key is ever present in this layer).
FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3) runner — minimal runtime with just the standalone server + static + public assets.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone binds localhost by default -> Cloud Run health checks would fail. Force 0.0.0.0.
ENV HOSTNAME=0.0.0.0
# Default port; Cloud Run overrides PORT at runtime (8080). Never hardcode 3000 in the server.
ENV PORT=8080

# Non-root runtime user.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# .next/standalone already contains server.js + minimal node_modules + the bundled roster.
# static assets and public/ are not included in standalone and must be copied alongside it.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
