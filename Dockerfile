# Build stage - install dependencies and prepare source
FROM docker.io/oven/bun:1.2.14-alpine AS build

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install all dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . ./

# Production stage - minimal Bun runtime
FROM docker.io/oven/bun:1.2.14-alpine AS production

# Install essential runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    curl \
    && rm -rf /var/cache/apk/*

# The bun user already exists in the base image, so we'll use it

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install only production dependencies
RUN bun install --frozen-lockfile --production && \
    bun pm cache rm

# Copy source code from build stage
COPY --from=build --chown=bun:bun /app/src ./src
COPY --from=build --chown=bun:bun /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=bun:bun /app/bunfig.toml ./bunfig.toml

# Change ownership of the app directory to the bun user
RUN chown -R bun:bun /app

# Switch to non-root user
USER bun

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Add labels for better container management
LABEL maintainer="Duck.ai OpenAI Server"
LABEL version="1.0.0"
LABEL description="OpenAI-compatible HTTP server using Duck.ai backend"

# Health check with proper endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application with Bun runtime
CMD ["bun", "run", "src/server.ts"]
