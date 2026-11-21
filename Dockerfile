# Build stage: install production dependencies only.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Runtime: distroless Node, no shell or package manager, runs as uid 65532.
# Files are root-owned, so the app cannot modify its own code.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY games ./games
COPY public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["server/index.js"]
