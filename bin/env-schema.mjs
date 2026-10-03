import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(value) {
  if (value === "~") return os.homedir();
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function splitRoots(value) {
  return value.split(",").map((root) => root.trim()).filter(Boolean);
}

function issue(severity, message) {
  return { severity, message };
}

function validateRoots(value) {
  const roots = splitRoots(value);
  if (roots.length === 0) return [issue("erreur", "au moins une racine de recherche est attendue")];
  return roots.flatMap((root) =>
    existsSync(path.resolve(expandHome(root))) ? [] : [issue("avertissement", `racine introuvable : ${root}`)]);
}

function validateEnum(allowed) {
  return (value) => (allowed.includes(value) ? [] : [issue("erreur", `valeur attendue : ${allowed.join(" ou ")}`)]);
}

function validateInteger(min, max) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return [issue("erreur", `entier attendu entre ${min} et ${max}`)];
    }
    return [];
  };
}

function validateText(value) {
  return value.trim() ? [] : [issue("erreur", "une valeur non vide est attendue")];
}

/**
 * The permission modes Claude Code accepts, minus "plan", which answers a run
 * with a plan instead of a merge request.
 */
export const permissionModes = ["manual", "acceptEdits", "auto", "dontAsk", "bypassPermissions"];

export const schema = [
  {
    key: "IMPL_SEARCH_ROOTS",
    label: "Racines de recherche des dépôts",
    comment: "Comma-separated directories scanned, up to two levels deep, for the checkout of a GitLab issue.",
    help: "Répertoires parcourus, jusqu'à deux niveaux, pour retrouver le checkout d'un ticket. Séparés par des virgules.",
    fallback: "~/workspace",
    kind: "list",
    readBy: "console",
    validate: validateRoots,
  },
  {
    key: "IMPL_PERMISSION_MODE",
    label: "Mode de permission des runs",
    comment: "Permission mode every run is started with; 'manual' asks before each tool and stops an unattended run.",
    help: "Mode de permission de chaque run. « manual » demande avant chaque outil et bloque un run non surveillé.",
    fallback: "auto",
    kind: "choice",
    options: permissionModes,
    readBy: "console",
    validate: validateEnum(permissionModes),
  },
  {
    key: "IMPL_SELF_IMPROVEMENT_AUTORUN",
    label: "Auto-audit à la fin de chaque run",
    comment: "Run a Claude Code self-audit after every completed workflow.",
    help: "Lance une auto-analyse Claude Code après chaque workflow terminé.",
    fallback: "true",
    kind: "boolean",
    readBy: "console",
    validate: validateEnum(["true", "false"]),
  },
  {
    key: "IMPL_REMOTE_CONTROL",
    label: "Remote Control sur le terminal d'un run",
    comment: "Set to 'false' to start a run without Remote Control, which makes its terminal reachable from claude.ai on your own account.",
    help: "Rend le terminal d'un run joignable depuis claude.ai, sur le compte déjà authentifié.",
    fallback: "true",
    kind: "boolean",
    readBy: "console",
    validate: validateEnum(["true", "false"]),
  },
  {
    key: "IMPL_PORT",
    label: "Port d'écoute",
    comment: "Port the local server and the browser use.",
    help: "Port du serveur local et de l'interface.",
    fallback: "3210",
    kind: "port",
    readBy: "both",
    validate: validateInteger(1, 65535),
  },
  {
    key: "IMPL_HOST",
    label: "Interface d'écoute",
    comment: "Network interface the local server binds to.",
    help: "Interface réseau du serveur local.",
    fallback: "127.0.0.1",
    kind: "text",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_NO_OPEN",
    label: "Démarrer sans ouvrir le navigateur",
    comment: "Set to 1 to start without opening the browser.",
    help: "1 pour démarrer sans ouvrir le navigateur.",
    fallback: "0",
    kind: "flag",
    readBy: "launcher",
    validate: validateEnum(["0", "1"]),
  },
  {
    key: "IMPL_MAX_CONCURRENT_RUNS",
    label: "Runs tenus en parallèle",
    comment: "How many Claude Code sessions the console holds at once; further launches wait in a queue.",
    help: "Nombre de sessions Claude Code tenues en même temps. Au-delà, les lancements attendent en file.",
    fallback: "3",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 10),
  },
  {
    key: "IMPL_SCHEDULE_TIMEOUT_MINUTES",
    label: "Délai de l'analyse d'un lot, en minutes",
    comment: "Minutes the analysis of a batch of tickets may take per repository; past it, the tickets of that repository run one at a time.",
    help: "Minutes laissées à l'analyse d'un lot de tickets, par dépôt. Au-delà, les tickets de ce dépôt passent un par un.",
    fallback: "5",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 60),
  },
  {
    key: "IMPL_WORKTREE_DEPENDENCY_DIRS",
    label: "Dossiers de dépendances repris dans le worktree d'un run",
    comment: "Comma-separated names of ignored dependency directories the worktree of a run takes from the main checkout, at any depth: cloned copy-on-write, symlinked where a clone is not possible. Never list build outputs.",
    help: "Noms des dossiers de dépendances ignorés par git que le worktree d'un run reprend du checkout principal, à toute profondeur. Séparés par des virgules. Pas de sorties de build.",
    fallback: "node_modules",
    kind: "list",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_WORKTREE_COPY_FILES",
    label: "Fichiers de configuration copiés dans le worktree d'un run",
    comment: "Comma-separated ignored files copied from the main checkout into the worktree of a run: a name pattern such as .env*, or a path from the repository root.",
    help: "Fichiers ignorés par git copiés du checkout principal vers le worktree d'un run : un motif de nom comme .env*, ou un chemin depuis la racine du dépôt. Séparés par des virgules.",
    fallback: ".env*,.claude/settings.local.json",
    kind: "list",
    readBy: "console",
    validate: validateText,
  },
  {
    key: "IMPL_STALL_MINUTES",
    label: "Silence avant un doute, en minutes",
    comment: "Minutes without any progress before the console voices a doubt about a run in progress. A doubt only: it never stops nor restarts anything.",
    help: "Minutes sans aucune progression avant que la console exprime un doute sur un run en cours. Un doute seulement : rien n'est arrêté ni relancé.",
    fallback: "10",
    kind: "text",
    readBy: "console",
    validate: validateInteger(1, 1440),
  },
  {
    key: "IMPL_DEMO_STEP_MS",
    label: "Durée d'une étape du mode démo, en millisecondes",
    comment: "Duration of each step of the simulated scenario, in milliseconds.",
    help: "Durée de chaque étape du scénario simulé, en millisecondes.",
    fallback: "5000",
    kind: "duration",
    readBy: "console",
    validate: validateInteger(1, 3_600_000),
  },
];

export function descriptorFor(key) {
  return schema.find((entry) => entry.key === key);
}

/** Anything the console reads only reaches it through a restart. */
export function needsRestart(descriptor) {
  return descriptor.readBy !== "launcher";
}
