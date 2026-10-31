# Security

**Português:** [Segurança](SECURITY.md)

Atlas includes tools that can remove files or change system settings. This document summarizes precautions for using and developing the application.

## Using the application

- Read the descriptions and review selected items before starting a cleanup or making a change.
- Back up your data before changing the Registry, services, firewall, drivers, or important settings.
- Some features need administrator privileges and may display the Windows User Account Control (UAC) prompt.
- Investigate a malware detection, YARA rule, or automatic recommendation before deleting a file.
- Windows repairs may take time and may require a restart. Do not interrupt an operation without understanding the effect.

## Secure development

When changing the project:

- Keep the interface separate from privileged operations in Electron's main process.
- Validate paths, parameters, and inputs before using them with processes or system APIs.
- Prefer running known programs with separate arguments instead of building commands by concatenation.
- Request confirmation before destructive or high-impact actions.
- Use administrator privileges only when an operation needs them.
- Do not store passwords, tokens, or keys in code, reports, or logs.
- Protect user data and avoid copying personal information into diagnostic records.

Using official Windows tools does not remove the need to validate inputs and handle errors. Review a feature on every supported system before distributing a change.

## Report a security issue

Do not publish details that could enable exploitation of an unpatched vulnerability. If the repository provides a private security channel, use it; otherwise, contact the maintainers before disclosing the issue. Include a clear description, reproduction steps, and observed impact. Remove passwords, tokens, keys, and personal data from evidence.

## Project checks

Before submitting a change, run the applicable checks:

```powershell
npm run check
npm run build
```

For installation and distribution instructions, see [Build and distribution](docs/BUILD.en.md). For hardware reading details, see [Hardware monitoring](docs/HARDWARE-MONITORING.en.md).
