FROM node:22.20.0-bookworm-slim
WORKDIR /museum/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY docs/C/ /museum/docs/C/
COPY design/style-guide/ /museum/design/style-guide/
RUN npm run build
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]
