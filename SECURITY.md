# Security and privacy

Authentication to Claude Code and the forges remains managed by the locally installed `claude`, `glab`, `gh`, Git and MCP clients. The console has a separate control credential.

## Console access

The console binds to `127.0.0.1` by default. At each start it creates a random control token, unless `IMPL_CONTROL_TOKEN` supplies one with at least 32 characters. The token is saved to `<data directory>/control-token` with owner-only permissions. `impl start` opens an association link with the token in the URL fragment, which is removed before the interface starts. The browser exchanges it for an HttpOnly, SameSite=Strict cookie. Browser sessions expire after twelve hours and every server restart invalidates them, even with a fixed control token. The CLI uses a Bearer token; a remote address requires an explicitly supplied token.

All console API routes and the WebSocket require authentication, except the health endpoint and the session association endpoint. Hooks use their own token and never accept the control credential instead. Every HTTP request must also carry a `Host` naming the console. The WebSocket requires an `Origin` the console serves, and HTTP requests with a foreign Origin are refused.

A network binding requires `IMPL_CONTROL_TOKEN`, `IMPL_TLS_CERT` and `IMPL_TLS_KEY`. The console refuses to start without these settings. A wildcard binding (`0.0.0.0` or `::`) also requires `IMPL_PUBLIC_URL`, the HTTPS origin clients use; the certificate must cover that hostname. Local HTTPS hooks pin the console certificate. An SSH tunnel to the loopback listener is an alternative. A valid Host or Origin is not an authentication credential. Give access only to someone allowed to drive agent sessions with the rights of the console's system account.

## Runtime data and archives

Tickets, terminal output, downloaded assets, test credentials and reports can be copied into the data directory. That directory and `.env` must not be committed or shared. A `.env` is parsed as configuration data and never sourced as a shell script.

Archived sources must be regular files inside the task directory; symbolic links in the source path are refused. Writes refuse symbolic-link destination parents. Archive reads are bounded to 20 MB per file and previews to 2 MB. HTTP bodies are limited to 2 MB and 30 seconds; WebSocket messages to 1 MB, pending actions to 64 per connection and queued output to 4 MB. Terminal input is limited to 8 KiB per message and 64 KiB/s with a 128 KiB burst shared across connections.

## Automatic improvements

Feedback and run observations are untrusted evidence. Automatic improvement and promotion are enabled by default. A branch can be merged without human approval after the mechanical policy, isolated checks and an independent judge agree. `IMPL_SELF_IMPROVEMENT_AUTORUN=false` disables the loop. Nothing is pushed automatically.

Candidate checks execute in a disposable Docker container from a trusted, locally available image (`IMPL_CHECK_IMAGE`, default `mcr.microsoft.com/playwright:v1.63.0-noble`). The runner exports the exact candidate commit with `git archive`; ignored files, local dependencies and the host's Git metadata are excluded. It mounts no host directory or Docker socket and forwards no host environment to check commands. It drops capabilities, runs as a non-root user, makes the image filesystem read-only and limits memory, CPU, processes, temporary storage, elapsed time and output.

The container starts on the bridge network for the installation phase: the trusted runner unpacks the source archive and executes `npm ci --ignore-scripts`. It then disconnects that network and verifies that no network remains attached before dependency scripts, typechecks, tests and build. The trusted console supplies the commands. Checks run with an empty environment apart from explicit runtime settings. Containers and exported archives are removed in a finally block. Docker and the image must already be available: otherwise automatic promotion is paused and the branch is retained, with no host execution fallback. Private dependencies that require credentials and tests that require external services need manual review; the runner does not forward those credentials or restore network access to pass them.

Docker, its daemon, the check image and the host kernel are trusted infrastructure. Container isolation does not protect against a vulnerability in that infrastructure. User-driven implementation sessions and the self-improvement author still use their configured Claude Code permissions; this isolation applies to the console's verification of candidate improvements.

Before publishing a fork, confirm that the data directory, `.claude/tasks/`, `.env` files, control tokens and terminal logs are absent from tracked files.
