# Service de classement : docker build -f server/Dockerfile -t polarity-classement .
# Variables obligatoires au lancement : TICKET_SECRET (≥ 32 caractères), ALLOWED_ORIGINS. Base : /data (volume persistant).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional
COPY src ./src
COPY server ./server
COPY tsconfig.json ./
ENV DATABASE_PATH=/data/leaderboard.sqlite PORT=8787 NODE_NO_WARNINGS=1
VOLUME /data
EXPOSE 8787
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
