# ==========================================
# OPTIMIZED PRODUCTION DOCKERFILE FOR SERVER
# ==========================================

# --- Stage 1: Build & Install Production Dependencies ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# --- Stage 2: Production Execution Image ---
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=6005

# Copy node_modules and server source files
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY server.js ./
COPY credentials.json* ./
COPY token.json* ./
COPY .env* ./

# Set non-root user for enhanced security
USER node

EXPOSE 6005

# Healthcheck to verify server readiness
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:6005/api/health || exit 1

CMD ["node", "server.js"]
