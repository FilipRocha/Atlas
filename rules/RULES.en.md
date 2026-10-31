# Contributing cleaning rules

**Português:** [Contribuir com regras de limpeza](RULES.md)

Atlas cleaning rules are JSON files organized by operating system. You can add or update a rule without changing the application interface.

## Structure

```text
rules/
  schema/rules.schema.json
  win32/      Windows rules
  darwin/     macOS rules
  linux/      Linux rules
```

Each platform folder can contain rules for apps, browsers, games, graphics caches, system files, and databases. Review existing JSON files before adding an entry.

## Tools

```powershell
npm run new-rule
npm run find-cache
npm run preview-rule
npm run parity-check
npm run validate:rules
npm run catalog
```

The `new-rule` generator guides you through creating a rule. `preview-rule` shows what would be scanned without deleting files. `catalog` updates the [rules catalog](CATALOG.en.md).

## Create a rule

Add the entry to the JSON file for the relevant platform. Simplified example:

```json
{
  "id": "acme-editor",
  "name": "Acme Editor",
  "paths": [
    "${APPDATA}/AcmeEditor/Cache/Cache_Data",
    "${APPDATA}/AcmeEditor/logs"
  ],
  "description": "Application cache and logs"
}
```

Use absolute paths based on variables supported by the project. Do not include documents, preferences, credentials, session tokens, bookmarks, saved games, or other user data.

## Path variables

Paths use variables defined by the rule loader. Common examples:

| Variable | Windows | macOS | Linux |
| --- | --- | --- | --- |
| `${HOME}` | User folder | User folder | User folder |
| `${APPDATA}` | Roaming data | — | — |
| `${LOCALAPPDATA}` | Local data | — | — |
| `${WINDIR}` | Windows folder | — | — |
| `${PROGRAMDATA}` | Shared program data | — | — |
| `${PROGRAMFILES}` | Program Files | — | — |
| `${PROGRAMFILES_X86}` | 32-bit Program Files | — | — |
| `${LIBRARY}` | — | `~/Library` | — |
| `${CACHES}` | — | `~/Library/Caches` | — |
| `${CONFIG}` | — | — | `~/.config` |
| `${CACHE}` | — | — | `~/.cache` |
| `${TMPDIR}` | Temporary directory | Temporary directory | Temporary directory |

Check the implementation and JSON schema for the full list and the variables valid on each platform.

## Field guidance

- Use lowercase IDs with hyphens, such as `my-application`.
- Use `/` in JSON paths; the loader adapts separators on Windows.
- Provide at least one path and explain in the description what will be removed.
- Use `minAgeDays` to preserve recent files when needed.
- Use `childSubdir`, `recursiveMatch`, or `fileMatch` only when the folder format requires them; these options have restrictions and must not expand the cleanup scope.
- For tasks that require administrator privileges, set `needsAdmin` on the system rule.
- Some performance caches may need `cacheReset`; explain that the next app launch may be slower.
- Available options and their limits are defined in `schema/rules.schema.json` and the rule loader code.

## Validate before submitting

```powershell
npm run validate:rules
npm test
```

Confirm that paths exist in a real installation and contain only disposable data. Prefer not to add a rule when you cannot establish that the files are safe to remove.
