#!/usr/bin/env bash
# Verifica el ritual de versión de CLAUDE.md antes de cada push a main:
#   1) que esta rama incluya todo lo que ya está en origin/main (base correcta,
#      ver el incidente de fa09bd6/534124f/d173da2 en CLAUDE.md), y
#   2) que si index.html o sw.js cambiaron, VERSION, la primera entrada del
#      CHANGELOG y CACHE subieron juntos y ninguno retrocedió.
#
# Instalar tras un clon nuevo (no viaja solo con git clone):
#   cp scripts/pre-push-check.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push

remote="$1"

mayor_o_igual() { # $1 >= $2 comparando como versiones, no como floats
  [ "$1" = "$2" ] && return 0
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue
  branch="${remote_ref#refs/heads/}"
  [ "$branch" != "main" ] && continue

  git fetch "$remote" main --quiet 2>/dev/null || true
  remote_main="$(git rev-parse --verify -q "$remote/main" 2>/dev/null || true)"

  if [ -n "$remote_main" ] && ! git merge-base --is-ancestor "$remote_main" "$local_sha" 2>/dev/null; then
    echo "✗ pre-push: esta rama no incluye todo $remote/main todavía." >&2
    echo "  Hacé 'git fetch && git rebase $remote/main' antes de subir." >&2
    exit 1
  fi

  if [ -z "$remote_main" ] || git diff --quiet "$remote_main" "$local_sha" -- index.html sw.js 2>/dev/null; then
    continue
  fi

  ver_local="$(git show "$local_sha:index.html" 2>/dev/null | grep -oP 'const VERSION = "\K[0-9.]+' | head -1)"
  ver_remoto="$(git show "$remote_main:index.html" 2>/dev/null | grep -oP 'const VERSION = "\K[0-9.]+' | head -1)"
  cache_local="$(git show "$local_sha:sw.js" 2>/dev/null | grep -oP 'const CACHE = "bsp-v\K[0-9]+' | head -1)"
  cache_remoto="$(git show "$remote_main:sw.js" 2>/dev/null | grep -oP 'const CACHE = "bsp-v\K[0-9]+' | head -1)"
  changelog_top="$(git show "$local_sha:index.html" 2>/dev/null | grep -oP '\["\K[0-9.]+(?=",)' | head -1)"
  [ -z "$ver_remoto" ] && ver_remoto="0"
  [ -z "$cache_remoto" ] && cache_remoto="0"

  fallo=""
  if [ -z "$ver_local" ]; then
    fallo="no se encontró VERSION en index.html"
  elif ! mayor_o_igual "$ver_local" "$ver_remoto" || [ "$ver_local" = "$ver_remoto" ]; then
    fallo="VERSION ($ver_local) no subió respecto a origin/main ($ver_remoto)"
  fi
  if [ -z "$fallo" ] && { [ -z "$cache_local" ] || [ "$cache_local" -le "$cache_remoto" ]; }; then
    fallo="CACHE (bsp-v$cache_local) no subió respecto a origin/main (bsp-v$cache_remoto)"
  fi
  if [ -z "$fallo" ] && [ "$changelog_top" != "$ver_local" ]; then
    fallo="la primera entrada del CHANGELOG ($changelog_top) no coincide con VERSION ($ver_local)"
  fi

  if [ -n "$fallo" ]; then
    echo "✗ pre-push: $fallo" >&2
    echo "  index.html o sw.js cambiaron: revisá VERSION, CHANGELOG y CACHE (ver CLAUDE.md)." >&2
    exit 1
  fi
  echo "✓ pre-push: VERSION $ver_local, CACHE bsp-v$cache_local, ritual OK."
done
