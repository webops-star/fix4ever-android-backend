### Multi-stage Dockerfile for Fix4ever backend
### Builder stage: install dev deps and compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Install build tools
RUN apk add --no-cache python3 make g++

# Copy package files first (cache npm install)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy environment file (optional) and the rest of the source for build
# NOTE: .env is excluded by default in .dockerignore. If you want to bake
# environment variables into the image you must remove .env from .dockerignore
# and ensure you understand the security implications (secrets baked into image).
# COPY .env .env # uncomment when running locally 
COPY . .

# Ensure public folder exists
RUN mkdir -p public/temp

# Build TypeScript to /usr/src/app/dist
RUN npm run build


### Runner stage: smaller production image
FROM node:20-alpine AS runner
WORKDIR /usr/src/app

# Install Puppeteer dependencies (Chromium and required libraries)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    && rm -rf /var/cache/apk/*

# Set Puppeteer to use installed Chromium
# On Alpine, chromium binary is at /usr/bin/chromium (not chromium-browser)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# RUN yarn prebuild
# RUN yarn build

# Copy compiled output and public assets and any plain JS direct routes
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/src/directRoutes.js ./src/directRoutes.js

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Default command - run the compiled app
CMD ["npm", "start"]
