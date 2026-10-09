#!/usr/bin/env bash
set -euo pipefail

repository="${IMPL_REPOSITORY:-https://github.com/Greg-Klein/implementation-factory.git}"
install_dir="${IMPL_INSTALL_DIR:-$HOME/.local/share/implementation-factory}"

if ! command -v git >/dev/null 2>&1; then
  printf 'Missing prerequisite: git\n' >&2
  exit 1
fi

if [[ -d "$install_dir/.git" ]]; then
  printf 'Updating %s...\n' "$install_dir"
  if [[ -n "${IMPL_REPOSITORY:-}" ]]; then
    git -C "$install_dir" remote set-url origin "$repository"
  fi
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" ]]; then
  printf 'The path already exists but does not contain the repository: %s\n' "$install_dir" >&2
  exit 1
else
  printf 'Installing into %s...\n' "$install_dir"
  mkdir -p "$(dirname "$install_dir")"
  git clone "$repository" "$install_dir"
fi

exec "$install_dir/install.sh"
