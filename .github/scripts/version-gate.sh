#!/usr/bin/env bash
# Decide si hay que publicar. Entrada: VERSION, package.json y los tags v* (env TAGS,
# uno por linea; si no se define se leen de git). Salida: version y should_release
# en $GITHUB_OUTPUT (o por stdout fuera de Actions).
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

version="$(tr -d '[:space:]' < VERSION)"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::VERSION='$version' no cumple MAJOR.MINOR.PATCH"
  exit 1
fi

pkg_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
if [ "$pkg_version" != "$version" ]; then
  echo "::error::VERSION ($version) y package.json ($pkg_version) no coinciden"
  exit 1
fi

tags="${TAGS-$(git tag -l 'v[0-9]*')}"
last="$(printf '%s\n' "$tags" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)"

if [ -z "$last" ]; then
  release=true
  reason="no hay tags previos"
elif [ "v$version" = "$last" ]; then
  release=false
  reason="la version $version ya esta publicada ($last)"
elif [ "$(printf 'v%s\n%s\n' "$version" "$last" | sort -V | tail -1)" = "v$version" ]; then
  release=true
  reason="$version es mayor que $last"
else
  release=false
  reason="la version $version es menor que el ultimo tag $last"
fi

if [ "$release" = true ]; then
  echo "Se publica $version: $reason"
  echo "### Publicando $version" >> "$summary"
else
  echo "::warning::Sin version nueva: $reason"
  echo "### Sin version nueva" >> "$summary"
fi
echo "$reason" >> "$summary"

{
  echo "version=$version"
  echo "should_release=$release"
} >> "$out"
