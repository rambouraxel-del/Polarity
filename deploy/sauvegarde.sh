#!/bin/sh
# Sauvegarde à chaud de la base du classement (copie cohérente, sans arrêter le service), puis copie vers ./sauvegardes/ sur la machine.
# À lancer depuis le dossier deploy/ de CETTE machine :  sh sauvegarde.sh
# Conservez ensuite les fichiers de ./sauvegardes/ AILLEURS (autre machine, stockage externe) : une copie sur le même disque ne protège pas d'une panne.
set -eu
NOM="classement-$(date -u +%Y%m%d-%H%M%S).sqlite"
docker compose exec -T classement node node_modules/tsx/dist/cli.mjs server/admin.ts backup "/data/sauvegardes/$NOM"
docker compose exec -T classement node node_modules/tsx/dist/cli.mjs server/admin.ts check
mkdir -p sauvegardes
docker compose cp "classement:/data/sauvegardes/$NOM" "sauvegardes/$NOM"
echo "Sauvegarde copiée : deploy/sauvegardes/$NOM"
