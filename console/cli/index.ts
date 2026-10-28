import { languageOf } from "../lib/i18n";
import { texts } from "../lib/i18n/texts";
import { CliError, consoleLanguage, consoleUrl, setClientLanguage } from "./client";
import { COMMANDS, USAGE, usage, type Context } from "./commands";

/**
 * The console from a terminal: every command is a client of the running
 * server, over the socket and the routes its page uses. Called by the `impl`
 * launcher, which names itself in `IMPL_PROGRAM` and the console in `IMPL_CONSOLE_URL`.
 */
async function main(argv: string[]) {
  const program = process.env.IMPL_PROGRAM?.trim() || "impl";
  const [name, ...rest] = argv;
  const base = consoleUrl(process.env);
  // The console decides the language; the shell's setting speaks when none answers.
  const language = (await consoleLanguage(base)) ?? languageOf(process.env.IMPL_LANGUAGE);
  setClientLanguage(language);
  const text = texts(language).cli;
  if (!name || name === "help" || name === "--help" || name === "-h") { console.log(usage(program, language)); return 0; }
  const command = COMMANDS[name];
  if (!command) throw new CliError(`${text.unknownCommand(name)}\n\n${usage(program, language)}`, USAGE);
  if (rest.includes("--help") || rest.includes("-h")) { console.log(`${text.usageOne(program, command.usage)}\n\n  ${command.summary(language)}`); return 0; }
  const context: Context = {
    base,
    program,
    language,
    print: (text) => console.log(text),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  };
  return command.run(context, rest);
}

// A pipe closed by its reader, `impl runs | head`, is the end of the command and not a failure of it.
process.stdout.on("error", (error: NodeJS.ErrnoException) => { if (error.code === "EPIPE") process.exit(0); throw error; });

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  if (error instanceof CliError) { console.error(error.message); process.exit(error.exitCode); }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
