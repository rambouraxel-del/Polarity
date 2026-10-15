#!/bin/sh
# Diagnostic AVANT mise à jour du service : LECTURE SEULE. Ne redémarre rien, ne migre rien, ne modifie aucun fichier,
# n'affiche aucun secret (TICKET_SECRET : seulement « défini » + longueur + « identique à .env » oui/non).
# À lancer depuis le dossier deploy/ du dépôt sur le VPS :  sh diagnostic-vps.sh
# Puis coller la sortie dans la conversation (elle ne contient pas de secret ; relisez-la tout de même).
# Volontairement SANS « server:admin check » : ce code ouvrirait la base en écriture avec le code courant.
cd "$(dirname "$0")" || exit 1
t() { printf '\n=== %s\n' "$1"; }

t "1. Commit du dépôt sur le serveur (et modifications locales)"
git rev-parse HEAD; git log -1 --format='%ci  %s'
git branch --show-current
git status --short | head -20; echo "(modifications ci-dessus : vide = arbre propre)"
git stash list | head -3

t "1b. Version API réellement servie (champ « api » absent = ancien service)"
DOM=$(grep -E '^LEADERBOARD_DOMAIN=' .env 2>/dev/null | cut -d= -f2-)
echo "domaine : ${DOM:-<non trouvé dans .env>}"
[ -n "$DOM" ] && curl -s -m 10 "https://$DOM/api/health"; echo
docker compose exec -T classement sh -c 'echo "version npm du conteneur : $(node -p "require(\"./package.json\").version" 2>/dev/null)"; echo "node $(node -v)"' 2>&1 | head -3

t "2. Services Docker"
docker compose ps
docker compose images 2>&1 | head -8
docker inspect --format '{{.Name}} créé={{.Created}} redémarrages={{.RestartCount}} santé={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' $(docker compose ps -q) 2>&1

t "3. Projet Compose, volumes, chemin réel de la base"
echo "COMPOSE_PROJECT_NAME dans .env : $(grep -E '^COMPOSE_PROJECT_NAME=' .env 2>/dev/null | cut -d= -f2-)"
docker compose config --format json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s);console.log("projet effectif :",c.name);console.log("volumes :",Object.keys(c.volumes||{}).join(", "));console.log("DATABASE_PATH :",c.services.classement.environment.DATABASE_PATH)}catch(e){console.log("(compose config illisible)")}})' 2>&1
docker volume ls --format '{{.Name}}' | grep -i -E 'donnees|polar'
for V in $(docker volume ls --format '{{.Name}}' | grep -E '_donnees$'); do echo "volume $V → $(docker volume inspect --format '{{.Mountpoint}}' "$V")"; done
docker compose exec -T classement ls -la /data 2>&1 | head -20
docker compose exec -T classement ls -la /data/sauvegardes 2>&1 | head -20

t "4. Schéma SQLite (ouverture en LECTURE SEULE) et taille"
docker compose exec -T classement node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/leaderboard.sqlite',{readOnly:true});console.log('user_version =',d.prepare('PRAGMA user_version').get().user_version);console.log('sqlite',d.prepare('select sqlite_version() v').get().v,' node',process.version);console.log('joueurs',d.prepare('select count(*) n from players').get().n,' parties',d.prepare('select count(*) n from runs').get().n)" 2>&1 | head -6

t "5. Espace disque et sauvegardes existantes"
df -h / /var/lib/docker 2>/dev/null
docker system df 2>&1 | head -6
ls -la sauvegardes 2>&1 | head -20
echo "(sauvegardes hors serveur : à confirmer par vous)"

t "7. Configuration conservée (valeurs secrètes JAMAIS affichées)"
if [ -f .env ]; then
  echo "variables définies dans .env (noms seulement) : $(grep -E '^[A-Z_]+=.+' .env | cut -d= -f1 | tr '\n' ' ')"
  echo "ALLOWED_ORIGINS (.env) : $(grep -E '^ALLOWED_ORIGINS=' .env | cut -d= -f2-)"
  TS=$(grep -E '^TICKET_SECRET=' .env | cut -d= -f2-)
  echo "TICKET_SECRET dans .env : $([ -n "$TS" ] && echo "défini, ${#TS} caractères" || echo ABSENT)"
  CS=$(docker compose exec -T classement sh -c 'printf %s "$TICKET_SECRET"' 2>/dev/null)
  [ -n "$TS" ] && [ "$TS" = "$CS" ] && echo "TICKET_SECRET du conteneur en cours = .env : OUI" || echo "TICKET_SECRET du conteneur en cours = .env : NON/inconnu (à examiner)"
  echo "ALLOWED_ORIGINS du conteneur : $(docker compose exec -T classement sh -c 'printf %s "$ALLOWED_ORIGINS"' 2>/dev/null)"
  ls -la .env | awk '{print "droits .env : "$1" "$3}'
else echo ".env introuvable dans $(pwd)"; fi
git check-ignore -q .env && echo ".env ignoré par git : oui" || echo ".env ignoré par git : NON (à corriger)"

t "8. Outils nécessaires aux commandes de migration/restauration"
docker --version; docker compose version
docker image inspect node:22-slim --format 'image node:22-slim présente : {{.Id}}' 2>&1 | cut -c1-80
echo "(si « No such image » : la restauration la téléchargera, accès réseau requis)"
sh -c 'command -v openssl >/dev/null && echo "openssl : oui" || echo "openssl : non"'
printf '\nFin du diagnostic (aucune modification effectuée).\n'
