# Cloud Run image for the uapply / ulearn API.
#
# Differences from the App Engine Dockerfile at the repo root (kept as is so
# App Engine deploys keep working during the move):
#   * NO .env files in the image. The settings come from Secret Manager,
#     mounted at run time (ENV_FILE). The first stage drops every .env* file
#     and only that cleaned tree is copied into the final image, so they are
#     not in any of its layers either.
#   * Started with plain `node` — Cloud Run restarts a crashed container
#     itself, so pm2 (production) and nodemon (staging) are not needed.
#   * Listens on $PORT (Cloud Run sets 8080; config.js already reads PORT).

FROM node:22-slim AS source
WORKDIR /src
COPY . .
RUN rm -rf .env .env.* node_modules .git _to_delete deploy \
 && find . -name ".DS_Store" -delete

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=source /src/package*.json ./
# `npm install`, not `npm ci`: package-lock.json is missing google-auth-library,
# so `npm ci` refuses it. (package.json "prepare" skips husky in production.)
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=source /src ./
# run as the unprivileged user the node image ships with
USER node
CMD ["node", "src/index.js"]
