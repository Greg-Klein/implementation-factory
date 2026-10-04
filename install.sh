#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="${IMPL_BIN_DIR:-$HOME/.local/bin}"

for command_name in node npm claude; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Prérequis manquant : %s\n' "$command_name" >&2
    exit 1
  fi
done

# Une forge suffit : glab pour les tickets GitLab, gh pour les tickets GitHub.
if ! command -v glab >/dev/null 2>&1 && ! command -v gh >/dev/null 2>&1; then
  printf 'Prérequis manquant : glab (tickets GitLab) ou gh (tickets GitHub), au moins un des deux.\n' >&2
  exit 1
fi
command -v glab >/dev/null 2>&1 || printf 'glab absent : les tickets GitLab ne pourront pas être traités.\n'
command -v gh >/dev/null 2>&1 || printf 'gh absent : les tickets GitHub ne pourront pas être traités.\n'

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  printf 'Node.js 22 ou plus récent est requis. Version détectée : %s\n' "$(node --version)" >&2
  exit 1
fi

printf 'Installation des dépendances…\n'
npm ci --prefix "$repo_root/console" --no-audit --no-fund
printf 'Compilation de l’interface…\n'
npm run build --prefix "$repo_root/console"

if [[ ! -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env.example" "$repo_root/.env"
fi

# Une mise a jour n'ecrit jamais dans un .env deja present : on se contente de
# signaler ce qui manque ou ce qui est invalide.
node "$repo_root/bin/config.mjs" check --quiet || true

mkdir -p "$bin_dir"
chmod +x "$repo_root/bin/implementation-harness"
ln -sfn "$repo_root/bin/implementation-harness" "$bin_dir/implementation-harness"
ln -sfn "$repo_root/bin/implementation-harness" "$bin_dir/impl"

printf '\nInstallation terminée.\n'
printf 'Configurer : impl config\n'
printf 'Lancer l’interface : impl\n'
printf 'Traiter les retours d’auto-amélioration : impl improve\n'
printf 'Voir toutes les commandes : impl help\n'
if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
  printf '\nAjoute %s à PATH, puis ouvre un nouveau terminal :\n' "$bin_dir"
  printf '  export PATH="%s:$PATH"\n' "$bin_dir"
fi
