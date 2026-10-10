#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { descriptorFor, needsRestart, schema } from "./env-schema.mjs";
import { applyEdits, readValues, renderExample, unterminatedKeys } from "./env-file.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.IMPL_ENV_FILE ?? path.join(repoRoot, ".env");
const launcher = path.join(repoRoot, "bin", "implementation-factory");
const SOURCE_LABELS = { shell: "shell", file: ".env", fallback: "default" };

function readEnvText() {
  try {
    return readFileSync(envPath, "utf8");
  } catch {
    return "";
  }
}

function writeEnvText(text) {
  // A temporary file in the same directory keeps an interrupted write from
  // leaving a truncated .env behind.
  const temporary = `${envPath}.${process.pid}.tmp`;
  const mode = existsSync(envPath) ? statSync(envPath).mode & 0o777 : 0o600;
  writeFileSync(temporary, text, { mode });
  renameSync(temporary, envPath);
}

function settings() {
  const fileValues = readValues(readEnvText());
  return schema.map((descriptor) => {
    const shell = process.env[descriptor.key];
    if (shell !== undefined && shell !== "") return { descriptor, value: shell, source: "shell" };
    const stored = fileValues[descriptor.key];
    if (stored !== undefined) return { descriptor, value: stored, source: "file" };
    return { descriptor, value: descriptor.fallback, source: "fallback" };
  });
}

function valueOf(key) {
  return settings().find((entry) => entry.descriptor.key === key).value;
}

function unknownKeys() {
  return Object.keys(readValues(readEnvText())).filter((key) => !descriptorFor(key));
}

/** Keys added to the schema after this .env was written. They fall back to their default. */
function missingKeys() {
  if (!existsSync(envPath)) return [];
  const present = readValues(readEnvText());
  return schema.map((descriptor) => descriptor.key).filter((key) => !(key in present));
}

function problems() {
  const found = settings().flatMap(({ descriptor, value }) =>
    descriptor.validate(value).map((entry) => ({ ...entry, key: descriptor.key })));
  const unknown = unknownKeys().map((key) => ({ severity: "warning", key, message: "unknown key, the factory does not read it" }));
  const absent = missingKeys().map((key) => ({ severity: "info", key, message: `missing from the .env, default value applied (${descriptorFor(key).fallback})` }));
  const broken = unterminatedKeys(readEnvText()).map((key) => ({ severity: "error", key, message: "unclosed quote, the line cannot be rewritten" }));
  return [...broken, ...found, ...unknown, ...absent];
}

function usage() {
  console.log(`Usage: impl config [subcommand]

  (none)            interactive assistant
  list              configuration in effect and where each value comes from
  get KEY           value in effect of a variable
  set KEY=VALUE     writes a variable without going through the assistant
  path              path of the .env file
  edit              opens the .env in $EDITOR then checks it
  check             checks the configuration without writing anything
  template          prints the .env.example matching the schema

A variable set in the shell wins over the .env, which wins over the default.
Exit codes of check: 0 valid, 1 at least one error.`);
}

function commandList() {
  console.log(`File: ${envPath}${existsSync(envPath) ? "" : " (missing)"}\n`);
  for (const { descriptor, value, source } of settings()) {
    console.log(`${descriptor.key.padEnd(30)} ${(descriptor.key === "IMPL_CONTROL_TOKEN" && value ? "(configured secret)" : value).padEnd(34)} ${SOURCE_LABELS[source]}`);
  }
  const unknown = unknownKeys();
  if (unknown.length > 0) console.log(`\nUnknown keys in the .env: ${unknown.join(", ")}`);
  return 0;
}

function commandCheck(quiet) {
  const found = problems();
  const failed = found.some((entry) => entry.severity === "error");
  if (found.length === 0) {
    if (!quiet) console.log(`Configuration valid: ${envPath}`);
    return 0;
  }
  const write = failed ? console.error : console.log;
  write(`File: ${envPath}`);
  const width = { error: "Error  ", warning: "Warning", info: "Info   " };
  for (const entry of found) write(`${width[entry.severity]} ${entry.key}: ${entry.message}`);
  if (failed) write("\nFix the configuration: impl config");
  return failed ? 1 : 0;
}

function commandGet(key) {
  const entry = settings().find((candidate) => candidate.descriptor.key === key);
  if (!entry) {
    console.error(`Unknown variable: ${key}`);
    return 1;
  }
  console.log(entry.value);
  return 0;
}

function reportInvalid(key, value) {
  const errors = descriptorFor(key).validate(value).filter((entry) => entry.severity === "error");
  for (const entry of errors) console.error(`${key}: ${entry.message}`);
  return errors.length > 0;
}

function persist(edits) {
  const broken = unterminatedKeys(readEnvText()).filter((key) => key in edits);
  if (broken.length > 0) {
    console.error(`Unclosed quote in the .env for ${broken.join(", ")}. Fix the line with impl config edit.`);
    return false;
  }
  writeEnvText(applyEdits(readEnvText(), edits, schema));
  return true;
}

function commandSet(assignment) {
  const separator = assignment.indexOf("=");
  if (separator <= 0) {
    console.error("Expected form: impl config set KEY=VALUE");
    return 1;
  }
  const key = assignment.slice(0, separator);
  const value = assignment.slice(separator + 1);
  if (!descriptorFor(key)) {
    console.error(`Unknown variable: ${key}`);
    return 1;
  }
  if (reportInvalid(key, value)) return 1;
  if (!persist({ [key]: value })) return 1;
  console.log(`${key} written to ${envPath}`);
  console.log(needsRestart(descriptorFor(key))
    ? "Restart the factory to apply: impl restart"
    : "Applied at the next start: impl");
  return 0;
}

function commandEdit() {
  if (!process.stdin.isTTY) {
    console.error("Non-interactive terminal: 'impl config path' gives the file to edit.");
    return 1;
  }
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
  if (!existsSync(envPath)) writeEnvText(renderExample(schema));
  const result = spawnSync(editor, [envPath], { stdio: "inherit" });
  if (result.error) {
    console.error(`Cannot start ${editor}: ${result.error.message}`);
    return 1;
  }
  return commandCheck(false);
}

/**
 * readline never settles a pending question when the input closes, so Ctrl-D
 * would otherwise end the assistant without a word.
 */
function ask(rl, prompt) {
  return new Promise((resolve, reject) => {
    const onClose = () => reject(new Error("input closed"));
    rl.once("close", onClose);
    rl.question(prompt).then(resolve, reject).finally(() => rl.off("close", onClose));
  });
}

function normalize(descriptor, answer) {
  const value = answer.trim();
  if (descriptor.kind === "boolean") {
    if (/^(o|oui|y|yes|true|1)$/i.test(value)) return "true";
    if (/^(n|non|no|false|0)$/i.test(value)) return "false";
  }
  if (descriptor.kind === "flag") {
    if (/^(o|oui|y|yes|true|1)$/i.test(value)) return "1";
    if (/^(n|non|no|false|0)$/i.test(value)) return "0";
  }
  return value;
}

function hint(descriptor) {
  if (descriptor.kind === "boolean" || descriptor.kind === "flag") return " (yes/no)";
  if (descriptor.kind === "choice") return ` (${descriptor.options.join(", ")})`;
  return "";
}

async function factoryIsListening() {
  const url = `${valueOf("IMPL_TLS_CERT") ? "https" : "http"}://${valueOf("IMPL_HOST")}:${valueOf("IMPL_PORT")}/api/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function runAssistant() {
  console.log(`Implementation Factory configuration\nFile: ${envPath}${existsSync(envPath) ? "" : " (it will be created)"}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const edits = {};
  const previousPort = valueOf("IMPL_PORT");
  try {
    for (const { descriptor, value, source } of settings()) {
      console.log(`${descriptor.label} (${descriptor.key})`);
      console.log(`  ${descriptor.help}`);
      if (source === "shell") {
        console.log(`  Set in the shell to '${descriptor.key === "IMPL_CONTROL_TOKEN" && value ? "(configured secret)" : value}', it will win over the .env.\n`);
      }
      for (;;) {
        const answer = normalize(descriptor, await ask(rl, `  [${descriptor.key === "IMPL_CONTROL_TOKEN" && value ? "(configured secret)" : value}]${hint(descriptor)} > `));
        if (answer === "" || answer === value) break;
        const errors = descriptor.validate(answer).filter((entry) => entry.severity === "error");
        if (errors.length === 0) {
          edits[descriptor.key] = answer;
          break;
        }
        for (const entry of errors) console.log(`  ${entry.message}`);
      }
      console.log("");
    }
  } catch {
    console.error("Aborted.");
    return 1;
  } finally {
    rl.close();
  }

  // Every answered key is persisted, so a configured .env mirrors the schema and
  // never reports a key as missing. A value that only comes from the shell is
  // left out: it belongs to that invocation, not to the file.
  const stored = readValues(readEnvText());
  for (const { descriptor, value, source } of settings()) {
    if (source !== "shell" && !(descriptor.key in stored) && !(descriptor.key in edits)) edits[descriptor.key] = value;
  }

  const ordered = Object.fromEntries(schema.filter((descriptor) => descriptor.key in edits).map((descriptor) => [descriptor.key, edits[descriptor.key]]));
  const changed = Object.keys(ordered);
  if (changed.length === 0) {
    console.log("No change.");
    return commandCheck(false);
  }
  if (!persist(ordered)) return 1;
  console.log(`${changed.length} key(s) written to ${envPath}.`);
  const status = commandCheck(true);

  if (!changed.some((key) => needsRestart(descriptorFor(key)))) return status;
  if (!(await factoryIsListening())) {
    console.log("Restart the factory to apply: impl restart");
    return status;
  }
  const confirm = readline.createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = (await ask(confirm, "A server is listening. Restart it now? [y/N] ")).trim().toLowerCase();
  } catch {
    answer = "";
  } finally {
    confirm.close();
  }
  if (!/^(o|oui|y|yes)$/.test(answer)) {
    console.log("Restart the factory to apply: impl restart");
    return status;
  }
  // Stopping needs the port the running server was started with, not the new one.
  spawnSync(launcher, ["stop"], { stdio: "inherit", env: { ...process.env, IMPL_PORT: previousPort } });
  spawnSync(launcher, [], { stdio: "inherit" });
  return status;
}

const [subcommand = "", argument] = process.argv.slice(2);

switch (subcommand) {
  case "help": case "--help": case "-h": usage(); process.exit(0); break;
  case "list": process.exit(commandList()); break;
  case "path": console.log(envPath); process.exit(0); break;
  case "check": process.exit(commandCheck(process.argv.includes("--quiet"))); break;
  case "template": process.stdout.write(renderExample(schema)); process.exit(0); break;
  case "edit": process.exit(commandEdit()); break;
  case "get":
    if (!argument) { console.error("Expected form: impl config get KEY"); process.exit(1); }
    process.exit(commandGet(argument));
    break;
  case "set":
    if (!argument) { console.error("Expected form: impl config set KEY=VALUE"); process.exit(1); }
    process.exit(commandSet(process.argv.slice(3).join("=")));
    break;
  case "":
    if (!process.stdin.isTTY) {
      commandList();
      console.error("\nNon-interactive terminal: use 'impl config set KEY=VALUE'.");
      process.exit(0);
    }
    process.exit(await runAssistant());
    break;
  default:
    console.error(`Unknown subcommand: ${subcommand}\n`);
    usage();
    process.exit(1);
}
