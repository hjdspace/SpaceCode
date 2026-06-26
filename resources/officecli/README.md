# OfficeCLI Binaries

This directory holds platform-specific OfficeCLI binaries that are bundled with SpaceCode.

## Platform → Binary filename

| Platform | Binary filename |
|---|---|
| Windows x64 | `officecli-win-x64.exe` |
| Windows ARM64 | `officecli-win-arm64.exe` |
| macOS Apple Silicon | `officecli-mac-arm64` |
| macOS Intel | `officecli-mac-x64` |
| Linux x64 | `officecli-linux-x64` |
| Linux ARM64 | `officecli-linux-arm64` |

## Development mode

### Option 1: Auto-download (recommended)

```bash
npm run download:officecli
```

This fetches the latest release from [GitHub Releases](https://github.com/iOfficeAI/OfficeCLI/releases)
and places the correct binary in this directory.

### Option 2: Manual download

Download from <https://github.com/iOfficeAI/OfficeCLI/releases> and place the binary
in this directory with the correct filename (see table above).

### Option 3: System-installed OfficeCLI

If you have installed OfficeCLI globally (e.g. via `officecli install`), the runtime
will automatically detect it at `~/.officecli/bin/officecli` or on the system `PATH`.
No file needs to be placed in this directory.

## Binary resolution order (runtime)

The `officeCliService.ts` → `resolveOfficeCliBinary()` function checks in this order:

1. **Bundled binary**: `resources/officecli/officecli-{platform}-{arch}[.exe]` (this directory)
2. **User-level install**: `~/.officecli/bin/officecli[.exe]` (from `officecli install`)
3. **System PATH**: `officecli` resolvable via PATH (dev mode only)

If none are found, all OfficeCLI features are gracefully disabled with fallback to Node.js skills.

## Packaged mode

In packaged builds, the binary is copied via `package.json` → `build.extraResources`:
```json
{ "from": "resources/officecli", "to": "officecli", "filter": ["**/*", "!README.md"] }
```

At runtime it resolves to `process.resourcesPath/officecli/officecli-{platform}-{arch}[.exe]`.
On first launch, `ensureOfficeCliInstalled()` runs `officecli install` to copy the binary
to `~/.officecli/bin/officecli` (standard name) so the AI agent's Bash tool can find it on PATH.
