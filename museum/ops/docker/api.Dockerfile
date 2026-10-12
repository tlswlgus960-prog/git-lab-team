FROM node:22.20.0-bookworm-slim
WORKDIR /museum/api
COPY api/package*.json ./
RUN npm ci --no-audit --no-fund
COPY api/ ./
COPY db/ /museum/db/
COPY contracts/ /museum/contracts/
COPY models/manifest.yaml /museum/models/manifest.yaml
RUN npm run build
CMD ["node", "dist/src/server.js"]
