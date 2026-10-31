# Build and distribution

**Português:** [Compilação e distribuição](BUILD.md)

This guide covers environment setup, development, and creation of Atlas packages.

## Requirements

- Node.js 22 or later and npm.
- To build the Windows package: Windows x64, the .NET 8 SDK, and Visual Studio Build Tools with the Desktop development with C++ workload.
- Build macOS or Linux packages on the corresponding operating system. macOS signing and notarization also require Apple distribution credentials.

## Install dependencies

Open a terminal in the project folder and run:

```powershell
npm ci
```

This installs the versions recorded in `package-lock.json`.

## Run during development

```powershell
npm run dev
```

On Windows, the command prepares the sensor collector and attempts to build the native process monitor. If a build tool is missing, Atlas displays a warning and may use fallbacks to continue development. To build the hardware collector manually:

```powershell
npm run build:hardware-bridge
```

To require a build of the native process monitor:

```powershell
npm run build:process-monitor
```

## Check and build

```powershell
npm run check
npm run build
```

`npm run check` runs type checks, linting, formatting validation, rule validation, and automated tests. `npm run build` builds the application but does not create an installer.

## Create packages

```powershell
npm run package:win
npm run package:mac
npm run package:linux
```

Packages are written to `dist/`. On Windows, `package:win` builds the required native components and creates the installer and x64 portable version. The installer requests Windows approval when needed.

The Windows build downloads the App Installer package directly from an official WinGet release and checks its size and GitHub-published SHA-256. The file is larger than 200 MB, stays local in `resources/winget/`, and must not be added to the repository.

The compiled collector also includes third-party notices and licenses in its resource folder. See the [collector notices](../THIRD-PARTY-NOTICES-LIBREHARDWAREMONITOR.en.md) for dependencies and their sources.

Run macOS and Linux commands on the target operating system. Output formats are defined in `electron-builder.yml`.

## QA reports

To generate automated reports:

```powershell
npm run qa:smoke
npm run qa:app-smoke
```

Reports are written to `qa-reports/`. The first command checks the code and tests. The second builds and launches an isolated Atlas instance to check window startup, navigation, and selected read-only queries. It must not run cleanup actions or change system settings.

See [Testing and QA reports](TESTING.en.md) for details.

## Source and generated files

Source code is kept separate from files created during installation or builds. `node_modules/`, `out/`, `dist/`, and native build directories are generated locally and can be recreated using this guide. Icons in `resources/` are project assets; `resources/hardware-bridge/` and the package in `resources/winget/` are generated or downloaded during Windows setup and must not be added to Git.

## Configuration files

- `package.json`: project commands and dependencies.
- `package-lock.json`: exact npm dependency versions.
- `electron.vite.config.ts`: Electron and interface build configuration.
- `electron-builder.yml`: installers, resources, and distribution targets.
- `tsconfig*.json`: TypeScript configuration.
