# Service de classement (Node 22 + SQLite). Construction depuis la RACINE du dépôt :
#   docker build -f server/Dockerfile -t polar-rift-classement .
# Variables obligatoires au lancement : TICKET_SECRET (≥ 32 caractères), ALLOWED_ORIGINS. Base : /data (volume persistant).
# En production, lancer via deploy/docker-compose.yml (HTTPS automatique par Caddy). Voir docs/GUIDE_DEPLOIEMENT.md.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Dépendances verrouillées ; pas de scripts d'installation (rien n'est compilé : le service tourne via tsx)
RUN npm ci --omit=optional --ignore-scripts && npm cache clean --force
COPY src ./src
COPY server ./server
COPY tsconfig.json ./
# Données : volume persistant, propriété de l'utilisateur non privilégié « node » (jamais de service en root)
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production DATABASE_PATH=/data/leaderboard.sqlite PORT=8787 HOST=0.0.0.0 NODE_NO_WARNINGS=1
USER node
VOLUME /data
EXPOSE 8787
# Sonde de santé : le service répond ET sa base est lisible (/api/health interroge SQLite)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
