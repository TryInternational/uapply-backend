FROM node:22

# Set build-time arg (default: production)
ARG APP_ENV=production
ENV NODE_ENV=${APP_ENV} APP_ENV=${APP_ENV}

# Install dependencies
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production  # Skip devDependencies in production

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