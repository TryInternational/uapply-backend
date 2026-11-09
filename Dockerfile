# -slim rather than the full Debian image: ~200 MB instead of ~1.1 GB. Nothing
# here needs the compilers and headers the full image carries (no native
# modules -- bcryptjs, not bcrypt), and every megabyte in the image is pulled
# onto the App Engine Flex boot disk, which has twice run out of space.
FROM node:22-slim

# Set build-time arg (default: production)
ARG APP_ENV=production
ENV NODE_ENV=${APP_ENV} APP_ENV=${APP_ENV}

# ffmpeg: WhatsApp only accepts OGG/Opus (or AAC/MP3/AMR) voice notes, browsers
# record WebM/Opus — the backend transcodes before sending (see sendVoice).
# chromium + fonts: the sub-agent agreement PDF is rendered by Puppeteer. The
# distro's Chromium is used instead of Puppeteer's own download (smaller,
# patched by Debian, and no 170 MB fetch at build time). Noto gives the Arabic
# (Naskh) face the agreement is set in when Google Fonts cannot be reached.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
       chromium fonts-noto-core fonts-noto-ui-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install dependencies
WORKDIR /usr/src/app
COPY package*.json ./
# Production dependencies only (--only=production is the deprecated spelling
# of --omit=dev). The npm cache is dropped so it is not baked into the layer.
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Copy app and .env file
COPY . .
RUN if [ "$APP_ENV" = "production" ]; then \
      cp .env.production .env; \
    else \
      cp .env.staging .env; \
    fi

# Start the app
EXPOSE 3000
CMD [ "sh", "-c", "if [ \"$APP_ENV\" = \"production\" ]; then npm start; else npm run dev; fi" ]