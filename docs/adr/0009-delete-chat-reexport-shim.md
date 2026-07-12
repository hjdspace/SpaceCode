# 删除 chat.ts 重导出 shim

## Context

`src/stores/chat.ts` 原本是聊天 store 的合并 facade（装饰性 proxy），在 ADR-0003 拆分 Turn store 时被删掉了大部分逻辑，只留下 9 行 re-export：

```typescript
export { useChatSessionStore } from './chatSession'
export { useTurnStore } from './turn'
export type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus } from '@/types'
export type { RewindOption, RewindState } from '@/types/rewind'
```

架构审查（`improve-codebase-architecture` skill #7）将其识别为遗留 shim：project_memory 明确记着"Decorative Proxies hide true module structure"——这个文件就是那条教训的遗物。

## Decision

删除 `src/stores/chat.ts`，所有 32 个消费方直接从源模块导入：

- `import { useChatSessionStore } from '@/stores/chatSession'`
- `import { useTurnStore } from '@/stores/turn'`

同时更新 2 个测试文件的动态 import 路径和 1 个测试文件的 `vi.mock` 路径。

**不新建模块**——这是删除操作，不是抽取。

## Rationale

- **少一个间接层**：IDE 跳转直接到达真实 store 定义，不再经过 shim 中转
- **清掉遗留约束**：project_memory 中"Proxy in chat.ts must be removed"约束已满足，更新为直接导入约定
- **零行为变更**：re-export 是透明的，删除后所有运行时行为不变

## Consequences

- 32 个源文件和 3 个测试文件的 import 路径更新
- `chat.ts` 不再存在——新增消费方必须显式选择导入 `chatSession` 还是 `turn`
- type re-export（Session、Message 等）无人使用，随 shim 一起消失
- project_memory 教训更新为泛化描述，不再引用已删除的文件
