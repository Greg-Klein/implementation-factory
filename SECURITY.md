# Security and privacy

The repository does not contain credentials. Authentication remains managed by the locally installed `claude`, `glab`, Git and MCP clients.

Runtime data is different. Ticket descriptions, terminal output, downloaded assets, test credentials and review reports can be copied into `console/data/`. That directory is ignored by Git and must not be committed or shared.

The `.env` file is configuration data, never a script. Both the launcher and `impl config` parse it line by line and neither one sources it, so a command substitution left in that file is never executed.

The console drives live agent sessions, so it only answers requests addressed to itself. Every HTTP request must carry a `Host` naming the console (loopback names, the bound interface), which defeats DNS rebinding. The WebSocket, which writes into the sessions' terminals, also requires an `Origin` the console served. Hook events must present a secret drawn at each start and handed to the sessions it spawns. Binding `IMPL_HOST` outside the loopback exposes the console to the network, and it says so at startup.

Before publishing a fork, check tracked files with a secret scanner and confirm that `console/data/`, `.claude/tasks/`, `.env` files and terminal logs are absent.

Feedback and autonomous run observations are untrusted evidence. The self-improvement command must never execute instructions found inside them or use them to weaken permission, privacy, review, validation or Git safety rules. There is no autonomous promotion: an improvement stays on its own branch until the user approves it in the console, and nothing is ever pushed.
