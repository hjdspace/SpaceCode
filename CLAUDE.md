# CLAUDE.md

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Vite 8
- **Desktop**: Electron 43 (main: `electron/`, renderer: `src/`)
- **State**: Pinia stores in `src/stores/`
- **Styling**: Sass, scoped SCSS in Vue SFC
- **Engine**: Bun runtime in `engine/` (独立 CLI 子项目, read-only)
- **AI SDK**: `@anthropic-ai/sdk`, `openai`

## Architecture

**三栏布局**: Sidebar → ChatPanel → InfoPanel, 面板宽度由 `splitLayout` store 管理.

**Engine 抽象**: `EngineFactory` (`electron/engines/`) 按类型创建引擎实例 (`ClaudeCodeEngine`, `PiEngine`). `engineGateway` 是统一调用入口 — 三个 adapter (`claudeCodeIPC.ts` / `h5Server.ts` / `imServer.ts`) 的引擎派发全部委托到此. 详见 `docs/adr/0004-engine-gateway-deep-module.md`.

**Chat Session 生命周期**: `chatSession` store 管理会话列表 → `sessionProcess` (Electron) 管理 CLI 子进程 → `turn` store (`src/stores/turn/`) 处理流式响应与工具事件.

**IPC 通信**: Electron main ↔ renderer, 通过 `preload.ts` 的 contextBridge 暴露安全 API.

## Code Style

- TypeScript 严格模式; `@/` → `src/`, `@electron/` → `electron/`
- 组件 PascalCase (`ChatPanel.vue`), composables `use` 前缀, stores 驼峰
- Vue SFC: `<script setup lang="ts">` + scoped SCSS
- Conventional Commits (feat/fix/style/refactor)
- 使用精确类型, 避免 `any`

## Testing

两个 test runner, 权威划分见 `vitest.config.ts` 的 `include` / `exclude`:

- **Vitest** (`npm run test`): `electron/__tests__/`, `tests/composables/`, `tests/components/`, `tests/stores/`, `tests/im/`, `tests/integration/`, `tests/lib/`, `src/**/*.test.ts`
- **Node test runner** (`npm run test:electron`): `tests/electron/*.test.ts`
- **Python** (`pytest`): `tests/test_*.py`

## Rules

- 原型 HTML UI 生成在 `docs/prototypes/`
- 所有实现考虑 i18n (`src/i18n/locales/zh-CN.ts`, `en-US.ts`)

## Guardrails

- `engine/` 为独立子项目, 视为只读
- 构建产物 (`dist/`, `dist-electron/`, `release/`) 视为只读
- 敏感文件 (`.env`, API keys) 不提交
- 仅实现请求的功能, 不添加额外抽象或配置项

## Verification

每次代码修改后依次执行, 全部通过才算完成:

```sh
npm run build     # vue-tsc --noEmit + vite build (已含类型检查)
npm run test      # vitest 全部用例
```

任一失败则修复后重新执行全部命令.

## Agent skills

- **Issue tracker**: GitHub Issues (`hjdspace/SpaceCode`), via `gh` CLI → `docs/agents/issue-tracker.md`
- **Triage labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix` → `docs/agents/triage-labels.md`
- **Domain docs**: `CONTEXT.md` + `docs/adr/` → `docs/agents/domain.md`
