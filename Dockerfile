# syntax=docker/dockerfile:1
#
# Canonical Nimiq mini-app image: Bun + Hono, runs TypeScript directly (no bundler).
# Data lives on a Fly volume (see fly.toml [[mounts]]), never baked into the image.
#
# This Dockerfile is the fleet template. The only per-app lines are DB_PATH and the
# start command; keep everything else identical across repos so one fix lands everywhere.

# ---- deps: resolve node_modules from a frozen lockfile (deterministic builds) ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- build: bundle the shared app-shell browser entry into public/dist ----
# The chain app is a no-bundler vanilla PWA, so the TS shell (i18n + dual-mode
# wallet + profile/lang UI) is pre-bundled here against the pinned shell version.
# public/dist is gitignored, so it is always built fresh against the lockfile —
# no committed bundle to skew (rollout playbook option b).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:shell

# ---- runtime ----
FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production

# App source first, then overlay the Linux-built node_modules + the freshly built
# bundle so the host's never wins and public/dist ships in the image.
COPY . .
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/public/dist ./public/dist

# SQLite path points at the mounted volume; PORT matches fly.toml internal_port.
ENV DB_PATH=/app/data/kids.db
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
