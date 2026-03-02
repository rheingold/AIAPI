# Windows UI Automation - Documentation Index

## For AI Assistants

**Start here**: [AI_ASSISTANT_MANUAL.md](AI_ASSISTANT_MANUAL.md)  
Complete operational guide with examples and troubleshooting.

## API References

- **[QUICK_REF.md](QUICK_REF.md)** - Quick reference card for common operations
- **[SERVER_API.md](SERVER_API.md)** - MCP Server HTTP JSON-RPC API
- **[WINKEYS_API.md](WINKEYS_API.md)** - WinKeys.exe command-line interface
- **[ERROR_CODES.md](ERROR_CODES.md)** - Complete error reference and remediation

## Project Information

- **[README.md](README.md)** - Project overview and quick start
- **[START_HERE.md](START_HERE.md)** - Getting started guide
- **[FIXES_SUMMARY.md](FIXES_SUMMARY.md)** - Recent design improvements (JSON consistency, PID/HANDLE support)
- **[API.md](API.md)** - High-level API concepts
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and design principles

## Source Code

- `src/` - TypeScript source code
  - `extension.ts` - VS Code extension entry point
  - `server/mcpServer.ts` - HTTP JSON-RPC server
  - `engine/automationEngine.ts` - Automation orchestration
  - `providers/windowsFormsProvider.ts` - Windows UI provider
- `tools/win/WinKeys.cs` - Windows automation binary source
- `dist/` - Compiled output
  - `start-mcp-server.js` - Server entry point
  - `win/WinKeys.exe` - Compiled binary

## Build & Configuration

- `package.json` - Node.js dependencies and scripts
- `tsconfig.json` - TypeScript compiler configuration
- `scripts/build-win-tools.ps1` - WinKeys.exe build script
- `.vscode/settings.json` - VS Code workspace settings
