#!/bin/sh
# Mise à jour du service (refonte cosmétique) AVEC sauvegarde récupérable préalable. À lancer depuis le dossier deploy/ de la machine du service :
#     sh mise-a-jour-service.sh <SHA-du-commit | main>
# Étapes : 1) sauvegarde SQLite cohérente + contrôle d'intégrité  2) archive du volume de données + copie du .env + état exact (commit, images)
#          3) récupération du code  4) construction  5) redémarrage  6) contrôle de santé.
# Rien n'est supprimé. En cas de problème : voir « Retour arrière » affiché à la fin (et docs/GUIDE_DEPLOIEMENT.md § 6).
set -eu
REF="${1:-main}"
cd "$(dirname "$0")"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p sauvegardes
OLD_SHA="$(git rev-parse HEAD)"

echo "== 1/6 Sauvegarde SQLite cohérente (à chaud) + contrôle d'intégrité"
sh sauvegarde.sh

echo "== 2/6 Archive du volume de données, copie du .env et état actuel"
docker compose run --rm --no-deps -T -v "$PWD/sauvegardes:/out" --entrypoint tar classement czf "/out/volume-donnees-$STAMP.tar.gz" -C /data .
tar tzf "sauvegardes/volume-donnees-$STAMP.tar.gz" | head -5
( cd sauvegardes && sha256sum "volume-donnees-$STAMP.tar.gz" > "volume-donnees-$STAMP.sha256" && cat "volume-donnees-$STAMP.sha256" )
if [ -f .env ]; then cp .env "sauvegardes/env-$STAMP"; chmod 600 "sauvegardes/env-$STAMP"; fi
{ echo "date_utc=$STAMP"; echo "commit_avant=$OLD_SHA"; docker compose images; docker compose ps; } > "sauvegardes/etat-avant-$STAMP.txt"
echo "Sauvegardes écrites dans deploy/sauvegardes/ (sqlite, volume-donnees-$STAMP.tar.gz, env-$STAMP, etat-avant-$STAMP.txt)."
echo ">>> COPIEZ ces fichiers AILLEURS (autre machine / stockage externe) avant de continuer si vous le pouvez."

echo "== 3/6 Récupération du code ($REF)"
git fetch origin
if [ "$REF" = "main" ]; then git checkout main && git pull --ff-only origin main; else git checkout "$REF"; fi
NEW_SHA="$(git rev-parse HEAD)"
echo "Commit déployé : $NEW_SHA"

echo "== 4/6 Construction (sans redémarrer)"
docker compose build

echo "== 5/6 Redémarrage (migration automatique de la base si besoin, copie .avant-vN.bak créée dans /data)"
docker compose up -d

echo "== 6/6 Santé"
i=0
until docker compose exec -T classement node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.json()).then(j=>{console.log(JSON.stringify(j));process.exit(j.ok?0:1)}).catch(()=>process.exit(1))"; do
  i=$((i + 1)); [ "$i" -ge 30 ] && { echo "Le service ne devient pas sain : voir le retour arrière ci-dessous."; break; }; sleep 2
done
docker compose exec -T classement node node_modules/tsx/dist/cli.mjs server/admin.ts check
docker compose ps

cat <<MSG

Terminé. Commit avant : $OLD_SHA   Commit après : $NEW_SHA
Retour arrière (le jeu actuel n'a pas changé ; les remboursements déjà écrits restent valides et ne se répètent pas) :
    git checkout $OLD_SHA && docker compose build && docker compose up -d
Restauration complète des données (seulement si la base est endommagée ; voir docs/GUIDE_DEPLOIEMENT.md § 6) :
    docker compose stop classement
    docker compose run --rm --no-deps -T -v "\$PWD/sauvegardes:/out" --entrypoint sh classement -c 'rm -f /data/leaderboard.sqlite-wal /data/leaderboard.sqlite-shm && tar xzf /out/volume-donnees-$STAMP.tar.gz -C /data'
    docker compose up -d
Vérification : node verifier-service.mjs --url https://<votre-service> (voir docs/PUBLICATION_BETA.md § 9 ter).
MSG
