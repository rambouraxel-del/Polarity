#!/bin/sh
# Méthode Git obligatoire avant tout travail sur `main` (voir CLAUDE.md « Méthode Git ») :
#   1. l'arbre doit être propre (sinon on s'arrête, rien n'est modifié) ;
#   2. main est synchronisée avec origin/main par FAST-FORWARD uniquement ;
#   3. une branche backup/pre-AAAAMMJJ-HHMMSS pointe exactement sur main, est poussée, puis VÉRIFIÉE sur GitHub ;
#   4. seules les 3 dernières branches dont le nom commence par « backup/pre- » sont conservées (GitHub et local) ; rien d'autre n'est jamais supprimé.
# En cas d'échec avant la vérification de la sauvegarde distante : aucune suppression, aucune modification du code. Usage : sh scripts/git-backup.sh
set -eu
PREFIX="backup/pre-"
KEEP=3
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "ARRÊT : modifications non commitées dans l'arbre de travail (rien n'a été modifié) :" >&2
  git status --short >&2
  exit 1
fi

git checkout main >/dev/null 2>&1 || { echo "ARRÊT : impossible de passer sur main." >&2; exit 1; }
git fetch origin main >/dev/null 2>&1 || { echo "ARRÊT : origin/main injoignable." >&2; exit 1; }
git merge --ff-only origin/main >/dev/null 2>&1 || { echo "ARRÊT : main ne peut pas avancer par fast-forward vers origin/main (divergence)." >&2; exit 1; }

NAME="${PREFIX}$(date -u +%Y%m%d-%H%M%S)"
HEAD_SHA="$(git rev-parse HEAD)"
git branch "$NAME" "$HEAD_SHA"
if ! git push origin "refs/heads/$NAME:refs/heads/$NAME" >/dev/null 2>&1; then
  git branch -D "$NAME" >/dev/null 2>&1 || true
  echo "ARRÊT : la sauvegarde n'a pas pu être poussée (rien d'autre n'a été modifié)." >&2
  exit 1
fi
REMOTE_SHA="$(git ls-remote --heads origin "refs/heads/$NAME" | awk '{print $1}')"
if [ "$REMOTE_SHA" != "$HEAD_SHA" ]; then
  echo "ARRÊT : la sauvegarde distante $NAME est absente ou différente (aucune suppression effectuée)." >&2
  exit 1
fi
echo "SAUVEGARDE_OK $NAME $HEAD_SHA"

# Purge : uniquement les noms commençant EXACTEMENT par « backup/pre- », en gardant les $KEEP plus récents (le nom est horodaté)
{
  git for-each-ref --format='%(refname:short)' "refs/heads/${PREFIX}*"
  git ls-remote --heads origin "refs/heads/${PREFIX}*" | sed 's#.*refs/heads/##'
} | sort -u | sort -r | awk -v keep="$KEEP" 'NR > keep' | while read -r old; do
  case "$old" in
    "${PREFIX}"*) ;;
    *) continue ;;
  esac
  git push origin --delete "$old" >/dev/null 2>&1 || echo "avertissement : suppression distante de $old impossible"
  git branch -D "$old" >/dev/null 2>&1 || true
  echo "ANCIENNE_SAUVEGARDE_SUPPRIMEE $old"
done
echo "SAUVEGARDES_RESTANTES: $(git ls-remote --heads origin "refs/heads/${PREFIX}*" | sed 's#.*refs/heads/##' | sort | tr '\n' ' ')"
