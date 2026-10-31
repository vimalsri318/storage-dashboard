# Build from the repository root:  docker build -f admin/Dockerfile -t storage-fleet-admin .
FROM node:24-alpine
WORKDIR /app
COPY admin ./admin
COPY lib/semver.js ./lib/semver.js
COPY public/style.css public/logo.svg ./public/
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4849 ADMIN_DB=/data/fleet.db TRUST_PROXY=1 SECURE_COOKIES=1
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4849
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4849/healthz || exit 1
CMD ["node", "admin/server.js"]
