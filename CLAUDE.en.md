# Atlas development guide

**Português:** [Orientações para trabalhar no Atlas](CLAUDE.md)

Atlas is a maintenance application built with Electron, React, and TypeScript. Preserve existing behavior and review nearby files before editing.

## Development

```powershell
npm ci
npm run dev
```

QA, build, and distribution commands are listed in `package.json` and described in `docs/BUILD.en.md` and `docs/TESTING.en.md`.

## Checks

```powershell
npm run check
npm test
npm run typecheck
npm run lint
npm run format:check
npm run validate:rules
```

Run the checks relevant to the change. Do not run formatters across the entire project when only one file needs adjustment.

## Commits and releases

Use Conventional Commits messages:

```text
<type>(<scope>): <short summary>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, and `chore`. The `npm run release -- patch|minor|major` command coordinates versioning and the release process; run it only when it is part of the task.

`conventional-changelog-angular` is an intentional direct dependency. The changelog generator needs version 8 at the top level of `node_modules`, even though another dependency uses version 9. Do not remove this dependency as if it were unused.

## Exploring the project

- Use focused searches with `rg` and list files with `rg --files`.
- Avoid searching `node_modules`, `out`, `dist`, generated files, and lockfiles unless the task requires it.
- Read enough context before changing behavior, especially for system code, cleanup, and administrative operations.
- Review all changes before completing the work.
