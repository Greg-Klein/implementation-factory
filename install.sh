#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="${IMPL_BIN_DIR:-$HOME/.local/bin}"

for command_name in node npm claude; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s\n' "$command_name" >&2
    exit 1
  fi
done

# One forge is enough: glab for GitLab tickets, gh for GitHub tickets.
if ! command -v glab >/dev/null 2>&1 && ! command -v gh >/dev/null 2>&1; then
  printf 'Missing prerequisite: glab (GitLab tickets) or gh (GitHub tickets), at least one of the two.\n' >&2
  exit 1
fi
command -v glab >/dev/null 2>&1 || printf 'glab is missing: GitLab tickets cannot be handled.\n'
command -v gh >/dev/null 2>&1 || printf 'gh is missing: GitHub tickets cannot be handled.\n'

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  printf 'Node.js 22 or newer is required. Detected version: %s\n' "$(node --version)" >&2
  exit 1
fi

printf 'Installing dependencies...\n'
npm ci --prefix "$repo_root/console" --no-audit --no-fund
printf 'Building the interface...\n'
npm run build --prefix "$repo_root/console"

if [[ ! -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env.example" "$repo_root/.env"
fi

# An update never writes to a .env that already exists: it only reports what
# is missing or invalid.
node "$repo_root/bin/config.mjs" check --quiet || true

mkdir -p "$bin_dir"
chmod +x "$repo_root/bin/implementation-harness"
ln -sfn "$repo_root/bin/implementation-harness" "$bin_dir/implementation-harness"
ln -sfn "$repo_root/bin/implementation-harness" "$bin_dir/impl"

printf '\nInstallation complete.\n'
printf 'Configure: impl config\n'
printf 'Start the interface: impl\n'
printf 'Handle the self-improvement feedback: impl improve\n'
printf 'See all commands: impl help\n'
if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
  printf '\nAdd %s to PATH, then open a new terminal:\n' "$bin_dir"
  printf '  export PATH="%s:$PATH"\n' "$bin_dir"
fi
