# Command-line guide

**Português:** [Guia da linha de comando](CLI.md)

Atlas can run tasks from a terminal without opening its window. Command availability depends on the operating system; some Windows actions require administrator privileges.

```text
atlas --cli <command> [subcommand] [options]
```

To view help for the installed version:

```powershell
atlas --cli --help
```

## File cleanup

Run a scan first. Scanning does not delete files:

```powershell
atlas --cli scan --all
atlas --cli scan --system --browser
```

To remove the findings, use `clean` or add `--clean` to a scan:

```powershell
atlas --cli clean --system --clean
atlas --cli clean --all --clean --json
```

Categories are `--system`, `--browser`, `--app`, `--gaming`, `--recycle-bin`, and `--all`. Review the results before using options that delete data.

## Commands

| Command | Action |
| --- | --- |
| `registry scan` / `registry fix [--all]` | Scan for or fix detected Registry issues. |
| `startup list` / `startup boot-trace` | List startup items or inspect boot time. |
| `startup enable <name>` / `startup disable <name>` / `startup delete <name>` | Change or remove a startup item. |
| `debloat scan` / `debloat remove <package,...>` / `debloat remove --all` | List or remove selected preinstalled packages. |
| `disk drives` / `disk analyze <drive>` / `disk file-types <drive>` | List drives or inspect storage usage. |
| `network scan` / `network clean [--all]` | Scan or clean available network items. |
| `malware scan` / `malware quarantine <path>` / `malware delete <path>` | Scan, quarantine, or delete a file. |
| `privacy scan` / `privacy apply [--all]` | Review or apply privacy options. |
| `drivers scan` / `drivers check-updates` / `drivers clean <name,...>` | Scan drivers, check for updates, or remove selected packages. |
| `drivers update [--all]` / `drivers ignore <id,...>` / `drivers unignore <id,...>` | Install updates or change the ignored update list. |
| `services scan` / `services disable <name>` / `services manual <name>` | Inspect or change Windows services. |
| `programs list` | List installed programs. |
| `updates check` / `updates run <id,...>` / `updates run --all` | Check for or install program updates through WinGet. |
| `perf info` / `perf disk-health` / `perf kill <pid>` | Inspect the system, disk health, or stop a process. |
| `leftovers scan` / `leftovers clean --path <path> [...]` | Find leftovers and clean only explicitly reviewed paths. |
| `history list` / `history clear` | View or clear scan history. |
| `restore-point create [description]` | Create a Windows restore point. |
| `repair gpu-restart` / `repair winre-status [--verbose]` | Restart graphics adapters or inspect WinRE on Windows. |
| `config get [key]` | Read settings; secret keys are hidden. |
| `service uninstall` / `service status` | Remove or inspect the Atlas service on Linux. |
| `metrics` / `metrics-server [--port <number>]` | Print Prometheus metrics or start the HTTP server. |

The metrics server uses port `9100` by default and exposes `/metrics` and `/health`.

## General options

| Option | Purpose |
| --- | --- |
| `--json` | Return data as JSON; progress is written to `stderr`. |
| `--verbose` | Show progress and diagnostic details. |
| `--quiet` or `-q` | Suppress normal output. Invalid usage and not-found messages remain visible; with `--json`, data is still emitted. |
| `--all` | Select all items in commands that support this option. |
| `--include-cache-resets` | Include cache resets in supported cleanup operations. The next app launch may be slower. |
| `--include-maintenance` | Include optional native maintenance in supported cleanup operations. Estimated savings are not provided. |
| `--help` or `-h` | Show help. |
| `--version` or `-v` | Show the version. |

Do not use `--verbose` and `--quiet` together.

## Examples

```powershell
atlas --cli registry scan --json
atlas --cli startup boot-trace
atlas --cli perf disk-health
atlas --cli leftovers scan --json
atlas --cli metrics-server --port 9200
```

### Clean program leftovers

Scan and review the returned paths first:

```powershell
atlas --cli leftovers scan --json
```

Then explicitly specify each path to clean:

```powershell
atlas --cli leftovers clean --path "C:\Users\Name\AppData\Local\Program\Cache" --json
```

The command rejects paths that were not included in a recent scan. It does not provide general cleanup through `--all` or wildcards.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | General error. |
| `2` | Invalid arguments or incorrect usage. |
| `3` | Insufficient permissions or elevation required. |
| `4` | Partial success; part of the operation failed. |
| `5` | No items found in operations that use this result, such as an empty cleanup or a missing startup item. |
| `6` | Unknown command. |
| `7` | The malware scan found threats. |
