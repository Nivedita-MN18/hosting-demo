# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Use npm ci for deterministic, reproducible installs (requires package-lock.json)
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

# Security: run as non-root user
RUN addgroup -S tracelite && adduser -S tracelite -G tracelite

COPY --chown=tracelite:tracelite --from=build /app/node_modules ./node_modules
# Copy source — .dockerignore excludes node_modules, .env, test/, .git
COPY --chown=tracelite:tracelite . .

USER tracelite

# Tell Render (and any load balancer) which port this service listens on.
# The actual PORT env var is set by Render at runtime — this is documentation only.
EXPOSE 3001

ENV NODE_ENV=production
CMD ["node", "src/server.js"]
