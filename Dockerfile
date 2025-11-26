FROM node:20-alpine

# Create app directory and user first
WORKDIR /app

# Use existing node user (UID 1000) from base image
RUN chown -R node:node /app

# Copy package files and change ownership
COPY --chown=node:node package*.json ./
COPY --chown=node:node tsconfig.json ./

# Switch to non-root user BEFORE installing dependencies
USER node

# Install ALL dependencies (including dev dependencies for build)
RUN npm ci && npm cache clean --force

# Copy source code
COPY --chown=node:node src ./src

# Build the TypeScript project
RUN npm run build

# Remove dev dependencies to keep image smaller
RUN npm ci --only=production && npm cache clean --force

# Expose port
EXPOSE 3000

# Start the application directly (no need to build again)
CMD ["node", "dist/src/server.js"]