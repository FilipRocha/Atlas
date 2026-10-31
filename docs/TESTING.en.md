# Testing and QA reports

**Português:** [Testes e relatórios de QA](TESTES.md)

The project provides quick code checks and an application startup check.

## Dependencies

From the project root, install dependencies:

```powershell
npm ci
```

## Code checks

```powershell
npm run check
```

This command checks types, lint, formatting, JSON rules, and unit tests. To generate a separate report for type checks and tests:

```powershell
npm run qa:smoke
```

The report is written to `qa-reports/qa-report.md` and `qa-reports/qa-report.json`. You can select checks or change the report directory:

```powershell
npm run qa:smoke -- --only typecheck
npm run qa:smoke -- --only unit-tests --report-dir .\my-reports
```

## Application startup and navigation

On Windows, run:

```powershell
npm run qa:app-smoke
```

The checker creates an isolated temporary profile, builds Atlas, opens its window, navigates pages through the menu, checks the driver manager, and runs read-only queries. The driver update check does not install or remove drivers. The checker does not run cleanup features or modify computer settings.

Default reports are `qa-reports/qa-app-report.md` and `qa-reports/qa-app-report.json`. Startup and observation timeouts can be adjusted:

```powershell
npm run qa:app-smoke -- --startup-timeout-ms 180000 --observe-ms 10000
```

The startup test covers a defined set of pages and queries; it does not replace manual review of every feature.
