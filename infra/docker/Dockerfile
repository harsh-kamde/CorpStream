FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/mcp-server/package*.json ./packages/mcp-server/
RUN npm ci --workspace=packages/mcp-server

COPY packages/mcp-server/ ./packages/mcp-server/
RUN npm run build --workspace=packages/mcp-server

# ── Production image ───────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/mcp-server/package*.json ./packages/mcp-server/
RUN npm ci --workspace=packages/mcp-server --omit=dev

COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "packages/mcp-server/dist/index.js"]
