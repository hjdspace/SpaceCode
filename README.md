# Claude Code GUI

> An AI-powered coding assistant with both CLI and Desktop GUI interfaces, built on top of the [Claude Code Best](https://github.com/claude-code-best/claude-code) reverse-engineered CLI.

[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![Electron](https://img.shields.io/badge/framework-Electron-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/framework-Vue%203-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

## Overview

This monorepo contains two complementary projects:

| Project | Description | Tech Stack |
|---------|-------------|------------|
| **claude-code** | CLI-based interactive AI coding assistant (terminal) | Bun, TypeScript, React/Ink |
| **claude-code-desktop** | Desktop GUI application wrapping the CLI engine | Electron, Vue 3, Vite, TypeScript |

## Features

### CLI (`claude-code`)

- 45+ built-in tools (Bash, FileEdit, Grep, Glob, WebFetch, WebSearch, LSP, MCP, etc.)
- 60+ slash commands (`/help`, `/model`, `/config`, `/compact`, `/diff`, `/review`, etc.)
- Multi-provider support (Anthropic, OpenAI, Gemini, Grok compatible)
- Pipe IPC multi-instance collaboration with LAN discovery
- Computer Use / Chrome Use for screen and browser control
- Voice Mode (Push-to-Talk)
- Extended thinking mode
- Session history and cost tracking
- MCP (Model Context Protocol) client with stdio/SSE/HTTP/WebSocket transports
- Custom model suppliers via `/login`

### Desktop (`claude-code-desktop`)

- Three-panel layout (Sidebar + Chat + Info Panel) inspired by VSCode
- Dark/Light theme with CSS Variables
- Markdown rendering with syntax highlighting
- Inline code diff viewer
- Integrated terminal (xterm.js + node-pty)
- File tree explorer
- Session history management
- Multi-LLM provider support (OpenAI, Anthropic, Gemini)
- QueryEngine integration from the CLI core
- Resizable panels with drag handles
- Native menu and system tray support

## Architecture

```
claude-code-gui/
├── claude-code/                    # CLI Project
│   ├── src/
│   │   ├── main.tsx                # CLI entry (Commander + React/Ink REPL)
│   │   ├── QueryEngine.ts          # Core query orchestration engine
│   │   ├── query.ts                # Query loop (API call → tool exec → re-query)
│   │   ├── Tool.ts                 # Tool interface definition
│   │   ├── tools.ts                # Tool registry (45+ tools)
│   │   ├── commands.ts             # Command registry (60+ commands)
│   │   ├── tools/                  # Tool implementations
│   │   │   ├── BashTool/           # Shell command execution
│   │   │   ├── AgentTool/          # Sub-agent spawning
│   │   │   ├── FileReadTool/       # File reading
│   │   │   ├── FileEditTool/       # File editing
│   │   │   ├── GrepTool/           # Content search (ripgrep)
│   │   │   ├── GlobTool/           # File globbing
│   │   │   ├── WebFetchTool/       # URL fetching
│   │   │   ├── WebSearchTool/      # Web search
│   │   │   ├── LSPTool/            # Language Server Protocol
│   │   │   ├── MCPTool/            # MCP tool proxy
│   │   │   └── ... (30+ more)
│   │   ├── commands/               # Command implementations
│   │   ├── services/
│   │   │   ├── api/                # Claude API client (streaming, retry, caching)
│   │   │   ├── mcp/                # MCP client (stdio/SSE/HTTP/WS)
│   │   │   ├── oauth/              # OAuth authentication
│   │   │   ├── lsp/                # Language Server management
│   │   │   └── ...
│   │   ├── components/             # React/Ink terminal UI components
│   │   ├── hooks/                  # React hooks
│   │   ├── state/                  # State management (Zustand)
│   │   ├── types/                  # TypeScript type definitions
│   │   └── utils/                  # Utility functions (200+ files)
│   └── packages/                   # Workspace packages
│       ├── @ant/claude-for-chrome-mcp/
│       ├── @ant/computer-use-*/
│       └── @ant/ink/
│
└── claude-code-desktop/            # Desktop GUI Project
    ├── electron/
    │   ├── main.ts                 # Electron main process
    │   ├── preload.ts              # Context bridge (IPC API)
    │   ├── queryEngineIntegration.ts  # CLI QueryEngine adapter
    │   ├── queryEngineBridge.ts    # IPC bridge for QueryEngine
    │   ├── terminalManager.ts      # PTY terminal manager
    │   └── services/               # Main process services
    ├── src/
    │   ├── App.vue                 # Root component (three-panel layout)
    │   ├── components/
    │   │   ├── layout/             # Sidebar, ChatPanel, InfoPanel, TitleBar
    │   │   ├── chat/               # Message rendering, input, Markdown
    │   │   ├── explorer/           # File tree browser
    │   │   ├── common/             # DiffViewer, CodeViewer
    │   │   ├── terminal/           # Integrated terminal (xterm.js)
    │   │   └── settings/           # Settings panel
    │   ├── stores/                 # Pinia state management
    │   │   ├── app.ts              # App-wide state (theme, panels)
    │   │   └── chat.ts             # Chat state (messages, sessions)
    │   ├── services/
    │   │   ├── llm.ts              # Multi-provider LLM client
    │   │   └── electronAPI.ts      # Renderer-side IPC wrapper
    │   └── styles/                 # SCSS + CSS Variables (dark/light)
    └── package.json
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3.11 (for CLI)
- [Node.js](https://nodejs.org/) >= 18 (for Desktop)
- An Anthropic-compatible API key

### CLI Setup

```bash
cd claude-code

# Install dependencies
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Run the built version
ccb
```

### Desktop Setup

```bash
cd claude-code-desktop

# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run electron:build
```

### Configuration

On first launch, use the `/login` command in the CLI or the Settings panel in the Desktop app to configure your LLM provider:

| Field | Description | Example |
|-------|-------------|---------|
| Base URL | API service endpoint | `https://api.anthropic.com/v1` |
| API Key | Authentication key | `sk-xxx` |
| Haiku Model | Fast model ID | `claude-haiku-4-5-20251001` |
| Sonnet Model | Balanced model ID | `claude-sonnet-4-6` |
| Opus Model | High-performance model ID | `claude-opus-4-6` |

Supports all Anthropic API-compatible services (OpenRouter, AWS Bedrock proxies, etc.).

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/login` | Configure API provider and credentials |
| `/model` | Switch between models |
| `/config` | Edit configuration |
| `/compact` | Compress conversation context |
| `/diff` | View code diffs |
| `/review` | Code review |
| `/cost` | Show usage costs |
| `/clear` | Clear conversation |
| `/doctor` | Run diagnostics |
| `/mcp` | Manage MCP servers |
| `/voice` | Toggle voice input |
| `/theme` | Switch theme |

## Tech Stack Details

### CLI

- **Runtime**: Bun (with Node.js compatibility)
- **Language**: TypeScript
- **UI Framework**: React + Ink (terminal rendering)
- **State Management**: Zustand
- **API Client**: @anthropic-ai/sdk with streaming
- **Build**: Custom Bun bundler (code splitting, ~450 chunks)
- **Linting**: Biome
- **Testing**: Bun test

### Desktop

- **Framework**: Electron 29+
- **Frontend**: Vue 3 (Composition API + `<script setup>`)
- **Build Tool**: Vite 5
- **Language**: TypeScript (strict mode)
- **Styling**: SCSS + CSS Variables (dark/light theme)
- **State Management**: Pinia
- **Terminal**: xterm.js + node-pty
- **Markdown**: marked + highlight.js
- **Icons**: Lucide Icons
- **LLM SDKs**: @anthropic-ai/sdk, openai
- **Packaging**: electron-builder (Windows/macOS/Linux)

## Project Structure Conventions

- CLI uses React/Ink for terminal UI — its component styles are terminal-specific and not reused in the Desktop app
- Desktop reuses CLI's business logic and rendering algorithms (Markdown config, Diff algorithms, message types), but implements its own UI layer with Vue
- IPC communication between Electron main process and renderer follows the preload context bridge pattern
- QueryEngine from the CLI is integrated into the Desktop app via an adapter layer in the main process

## License

See individual project directories for license information.
