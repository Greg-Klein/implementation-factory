import { CliError, consoleUrl } from "./client";
import { COMMANDS, USAGE, usage, type Context } from "./commands";

/**
 * The console from a terminal: every command is a client of the running
 * server, over the socket and the routes its page uses. Called by the `impl`
 * launcher, which names itself in `IMPL_PROGRAM` and the console in `IMPL_CONSOLE_URL`.
 */
async function main(argv: string[]) {
  const program = process.env.IMPL_PROGRAM?.trim() || "impl";
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help" || name === "-h") { console.log(usage(program)); return 0; }
  const command = COMMANDS[name];
  if (!command) throw new CliError(`Unknown command: ${name}\n\n${usage(program)}`, USAGE);
  if (rest.includes("--help") || rest.includes("-h")) { console.log(`Usage: ${program} ${command.usage}\n\n  ${command.summary}`); return 0; }
  const context: Context = {
    base: consoleUrl(process.env),
    program,
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
