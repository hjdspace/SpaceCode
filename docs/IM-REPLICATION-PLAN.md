# cc-haha IM 集成功能技术复刻方案

> 本方案基于对开源项目 cc-haha（`D:\AI\cc-haha`）IM 接入子系统的全面技术分析，提供从架构到实现、配置到测试的完整复刻路径。
> 适用范围：在新项目环境中复刻「通过 Telegram / 飞书 / 微信 / 钉钉 / WhatsApp 远程对话 Claude Code、切换项目、审批权限」的能力。
> 分析基准：cc-haha 仓库 `adapters/` + `src/server/` + `desktop/electron/services/` 完整源码。

---

## 目录

1. [总体架构](#1-总体架构)
2. [系统设计图](#2-系统设计图)
3. [组件分解](#3-组件分解)
4. [数据流与协议](#4-数据流与协议)
5. [核心算法](#5-核心算法)
6. [实现步骤](#6-实现步骤)
7. [依赖清单](#7-依赖清单)
8. [配置规范](#8-配置规范)
9. [测试流程](#9-测试流程)
10. [复刻注意事项](#10-复刻注意事项)
11. [风险与改进建议](#11-风险与改进建议)

---

## 1. 总体架构

### 1.1 设计哲学

cc-haha 的 IM 集成采用「**长连接拉取 + 本地 WS 桥接 + sidecar 进程隔离**」三层设计，核心目标是让桌面端可以躲在 NAT 后面，**无需公网回调 / ngrok / 公网 IP** 即可远程对话 Claude Code。

> ⚠️ **安全提示**：「无需公网回调」仅指 IM 平台方向；服务端 WS 通道 `/ws/:sessionId` 在 cc-haha 原项目生产环境实际绑定 `0.0.0.0`（见 `desktop/electron/services/sidecarManager.ts:8` 的 `SERVER_BIND_HOST = '0.0.0.0'`），且默认无鉴权。复刻时**必须**为该通道强制启用 token 鉴权（详见 §6.1 step 3 与 §11.1 风险条目）。

关键设计选择：

| 选择 | 理由 |
|---|---|
| 所有 IM 平台走长连接 / 长轮询 | 桌面端无需公网入口，适合个人开发者 |
| IM 适配器作为独立 sidecar 进程 | 进程隔离，单个 adapter 崩溃不影响 desktop |
| 复用 desktop server 的 WS 通道 | IM / desktop UI / H5 共用 `/ws/:sessionId`，无需为 IM 单独建桥 |
| **WS 通道强制 token 鉴权**（相对 cc-haha 原项目的安全增强） | 原项目默认无鉴权且绑 `0.0.0.0`，存在同网段攻击面；复刻必须修复 |
| 配对码授权（非 OAuth） | 简单、无第三方依赖、适合本地工具 |
| chatId 串行化队列 | 防止慢 handler 与快 handler 竞争状态 |
| common 层零服务端依赖 | 适配器可独立发布，避免循环依赖 |

### 1.2 四层架构

```
┌────────────────────────────────────────────────────────────────────┐
│ L1 配置层  Desktop Webapp (React + Zustand)                         │
│   AdapterSettings.tsx → adapterStore → PUT /api/adapters            │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTP REST
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ L2 服务端层  Bun Server (src/server)                                │
│   ├─ /api/adapters         配置读写（脱敏 + 原子写）                 │
│   ├─ /api/sessions         会话 CRUD                                 │
│   ├─ /api/adapters/{plat}/login/*  扫码绑定                          │
│   ├─ /ws/:sessionId        客户端 WS（desktop / H5 / IM adapter）    │
│   ├─ /sdk/:sessionId       CLI 子进程 WS（token 鉴权）               │
│   └─ conversationService   CLI 子进程管理 + SDK 桥接 + 权限路由      │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ ws://127.0.0.1:{port}/ws/{sid}
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ L3 适配器层  Adapter Sidecar (adapters/)                             │
│   ├─ common/               平台无关内核                              │
│   │   ├─ ws-bridge.ts       WS 桥接 + 重连 + 心跳 + 串行化           │
│   │   ├─ chat-queue.ts      入站事件串行队列                         │
│   │   ├─ session-store.ts   chatId↔sessionId 持久化                  │
│   │   ├─ session-recovery.ts 启动恢复                               │
│   │   ├─ message-buffer.ts  流式节流                                │
│   │   ├─ message-dedup.ts   去重（TTL + LRU）                       │
│   │   ├─ permission.ts      权限命令解析                             │
│   │   ├─ pairing.ts         配对码授权                              │
│   │   ├─ http-client.ts     REST 客户端                             │
│   │   ├─ config.ts          配置加载                                │
│   │   ├─ format.ts          消息格式化                              │
│   │   └─ attachment/        附件存储 + 限额 + 图片扫描               │
│   └─ {telegram,feishu,dingtalk,wechat,whatsapp}/  平台实现          │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ stdin / stdout (stream-json)
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ L4 会话层  Claude Code CLI 子进程                                    │
│   --output-format stream-json --include-partial-messages            │
│   --sdk-url ws://127.0.0.1:{port}/sdk/{sid}?token=...               │
└────────────────────────────────────────────────────────────────────┘
```

### 1.3 进程拓扑

```
Electron 主进程
├─ Bun Server Sidecar (1 个)
│   ├─ HTTP :{动态端口}
│   └─ 管理 N 个 Claude CLI 子进程
├─ IM Adapter Sidecar (最多 5 个，按需启动)
│   ├─ telegram adapter (有 botToken 才启动)
│   ├─ feishu adapter (有 appId+appSecret 才启动)
│   ├─ dingtalk adapter (有 clientId+clientSecret 才启动)
│   ├─ wechat adapter (有 accountId+botToken 才启动)
│   └─ whatsapp adapter (有 auth state 才启动)
└─ Desktop UI (Electron renderer)
```

---

## 2. 系统设计图

### 2.1 端到端时序图（用户发消息 → Claude 回复）

```
IM 用户          IM 平台          Adapter Sidecar        Bun Server          Claude CLI
  │                │                   │                     │                    │
  │  发文本消息    │                   │                     │                    │
  ├───────────────►│                   │                     │                    │
  │                │  长连接推送       │                     │                    │
  │                ├──────────────────►│                     │                    │
  │                │                   │                     │                    │
  │                │   ┌──────────────┴──────────────┐      │                    │
  │                │   │ 1. isAllowedUser 校验       │      │                    │
  │                │   │ 2. MessageDedup.tryRecord   │      │                    │
  │                │   │ 3. enqueue(chatId, fn)      │      │                    │
  │                │   │ 4. restoreStoredSessionBinding │   │                    │
  │                │   │    ├─ 已有 session → 重连 WS │      │                    │
  │                │   │    └─ 无 session → POST     │      │                    │
  │                │   │       /api/sessions 建会话  │      │                    │
  │                │   └──────────────┬──────────────┘      │                    │
  │                │                  │ POST /api/sessions   │                    │
  │                │                  ├────────────────────►│                    │
  │                │                  │ ◄── sessionId ──────┤                    │
  │                │                  │                      │ spawn CLI 子进程   │
  │                │                  │                      ├───────────────────►│
  │                │                  │ ws connect /ws/{sid} │                    │
  │                │                  ├────────────────────►│                    │
  │                │                  │ ◄── connected ──────┤                    │
  │                │                  │                      │                    │
  │                │                  │ sendUserMessage      │                    │
  │                │                  │ {type:user_message}  │                    │
  │                │                  ├────────────────────►│                    │
  │                │                  │                      │ SDK user msg       │
  │                │                  │                      ├───────────────────►│
  │                │                  │                      │                    │
  │                │                  │                      │   stream_event     │
  │                │                  │                      │◄───────────────────┤
  │                │                  │ ◄── content_delta ──┤                    │
  │                │   ┌──────────────┴──────────────┐      │                    │
  │                │   │ MessageBuffer.append        │      │                    │
  │                │   │ → 500ms / 200字 flush       │      │                    │
  │                │   │ → editMessage / 卡片更新    │      │                    │
  │                │   └──────────────┬──────────────┘      │                    │
  │                │  流式文本        │                     │                    │
  │                │◄─────────────────┤                     │                    │
  │  流式显示      │                   │                     │                    │
  │◄───────────────┤                   │                     │                    │
  │                │                  │                      │   result           │
  │                │                  │                      │◄───────────────────┤
  │                │                  │ ◄── message_complete┤                    │
  │                │                  │ MessageBuffer.complete                    │
  │                │  最终文本        │                     │                    │
  │                │◄─────────────────┤                     │                    │
  │  最终回复      │                   │                     │                    │
  │◄───────────────┤                   │                     │                    │
```

### 2.2 权限审批时序图

```
Claude CLI                  Bun Server              Adapter              IM 用户
    │                            │                       │                     │
    │  control_request           │                       │                     │
    │  (can_use_tool)            │                       │                     │
    ├───────────────────────────►│                       │                     │
    │                            │ pendingPermissionRequests.set(reqId)         │
    │                            │ translateCliMessage → permission_request    │
    │                            ├──────────────────────►│                     │
    │                            │                       │ buildPermissionCard │
    │                            │                       │ sendInlineKeyboard  │
    │                            │                       ├────────────────────►│
    │                            │                       │                     │ 卡片+3按钮
    │                            │                       │                     │ ✅ 允许
    │                            │                       │                     │ ♾️ 永久允许
    │                            │                       │                     │ ❌ 拒绝
    │                            │                       │                     │
    │                            │                       │◄────────────────────┤
    │                            │                       │ callback_query      │
    │                            │                       │ parsePermitCallback │
    │                            │                       │   Data(data)        │
    │                            │                       │ sendPermissionResponse
    │                            │                       │ {type:permission_   │
    │                            │                       │  response,          │
    │                            │                       │  requestId,         │
    │                            │                       │  allowed, rule?}    │
    │                            │◄──────────────────────┤                     │
    │                            │ respondToPermission   │                     │
    │                            │ → control_response    │                     │
    │  control_response          │                       │                     │
    │◄───────────────────────────┤                       │                     │
    │  (allow / deny)            │                       │                     │
    │                            │                       │                     │
    │  继续执行工具 / 中止       │                       │                     │
    │  ...                       │                       │                     │
```

### 2.3 模块依赖图

```
                    ┌──────────────┐
                    │  config.ts   │  (env > JSON > 默认值)
                    └──────┬───────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  pairing.ts  │  │ http-client  │  │ attachment/*     │
│ (配对码授权) │  │   .ts        │  │ (附件存储/限额)   │
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘
       │                 │                   │
       │                 │                   │
       ▼                 ▼                   ▼
┌──────────────────────────────────────────────────────┐
│                    ws-bridge.ts                       │
│  (WS 池 + 重连 + 心跳 + handlerChains 串行化)         │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ chat-queue.ts  │  (入站事件串行)
              └────────┬───────┘
                       │
                       ▼
              ┌────────────────┐    ┌────────────────┐
              │ session-store  │◄──►│ session-       │
              │   .ts          │    │ recovery.ts    │
              └────────────────┘    └────────────────┘
                       │
                       ▼
              ┌────────────────┐    ┌────────────────┐
              │ message-buffer │    │ message-dedup  │
              │   .ts (节流)   │    │   .ts (去重)   │
              └────────────────┘    └────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ permission.ts  │  (命令解析)
              │  format.ts     │  (消息格式化)
              └────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  platform adapters           │
        │  telegram / feishu /         │
        │  dingtalk / wechat /         │
        │  whatsapp                    │
        └──────────────────────────────┘
```

---

## 3. 组件分解

### 3.1 Common 层组件清单

| 组件 | 文件 | 行数 | 职责 | 关键算法 |
|---|---|---|---|---|
| WsBridge | `ws-bridge.ts` | ~300 | WS 连接池 + 重连 + 心跳 + **出站**串行化 | 指数退避 1s→30s×10、handlerChains FIFO Promise 链（M3：每 100 条截断） |
| ChatQueue | `chat-queue.ts` | 24 | **入站**事件串行化（与 WsBridge.handlerChains 分工：ChatQueue 串行化 IM 平台 → adapter 的入站事件，handlerChains 串行化 adapter → server 的出站 WS 消息；两者不可合并，入站 / 出站是独立流水线） | Promise 链 + finally 清理 |
| SessionStore | `session-store.ts` | ~90 | chatId↔sessionId 持久化 | 每次 read refresh（M2：mtime 缓存）+ tmp+rename 原子写 |
| SessionRecovery | `session-recovery.ts` | ~90 | 启动恢复 + 死会话清理 | 6 步算法 + 依赖注入 |
| MessageBuffer | `message-buffer.ts` | ~100 | 流式节流 | 500ms/200字 双触发 + pendingComplete 防并发 |
| MessageDedup | `message-dedup.ts` | ~55 | 消息去重 | Map LRU + TTL 10min + **完整扫描**（修复 S2：不保留 sweep 短路） |
| Permission | `permission.ts` | ~150 | 权限命令解析 | 显式命令 + 单 pending 快捷回复 |
| Pairing | `pairing.ts` | ~150 | 配对码授权 | SAFE_ALPHABET + crypto.randomInt + 5min/5次速率限制 |
| HttpClient | `http-client.ts` | ~390 | REST 客户端 | 30s 超时 + 4 级 matchProject + 路径白名单 |
| Config | `config.ts` | ~190 | 配置加载 | env > JSON > 默认值 + 5 级 workDir fallback |
| Format | `format.ts` | ~300 | 消息格式化 | 段落优先切分 + GFM 表格转 bullet |
| AttachmentStore | `attachment/store.ts` | ~120 | 附件落盘 | sanitize + 碰撞避让 + tmp.part+rename + 双阈值 GC |
| AttachmentLimits | `attachment/limits.ts` | ~60 | 限额校验 | image 10MB / file 30MB / MIME 白名单 |
| ImageBlockWatcher | `attachment/image-block-watcher.ts` | ~85 | 出站图片扫描 | 正则匹配 + DJB2 指纹去重 + 跨 feed 缓冲 |

### 3.2 平台适配器组件清单

| 平台 | 核心文件 | 启动方式 | 流式实现 | 权限卡片 | 出站媒体 |
|---|---|---|---|---|---|
| Telegram | `index.ts` + `commands/format/media/menu.ts` | grammY 长轮询 | 占位消息+editMessageText | InlineKeyboard 3 按钮 | ✅ sendPhoto |
| 飞书 | `index.ts` + `cardkit/streaming-card/flush-controller/extract-payload/card-errors/markdown-style/media/path-safety.ts` | Lark WSClient | CardKit 5 步协议 | Schema 2.0 卡片 | ✅ im.image.create |
| 钉钉 | `index.ts` + `ai-card/helpers/media/permission-card/stream-state.ts` | dingtalk-stream DWClient | AI 卡片 PUT /card/streaming | AI 卡片模板 | ❌ |
| 微信 | `index.ts` + `media/protocol/typing.ts` | HTTP 长轮询 | MessageBuffer 3s 积累+一次性 | 纯文本 | ❌ |
| WhatsApp | `index.ts` + `format/media/protocol/session.ts` | Baileys WhatsApp Web | 累积+一次性+presence | 纯文本 | ✅ sendMedia |

### 3.3 服务端组件清单

| 组件 | 文件 | 职责 |
|---|---|---|
| Server | `src/server/index.ts` | Bun.serve HTTP+WS 启动、路由分发 |
| WS Handler | `src/server/ws/handler.ts` | WS 生命周期、消息路由、translateCliMessage |
| Events | `src/server/ws/events.ts` | ClientMessage / ServerMessage 联合类型定义 |
| ConversationService | `src/server/services/conversationService.ts` | CLI 子进程管理、SDK WS 桥接、权限请求缓存 |
| AdapterService | `src/server/services/adapterService.ts` | `~/.claude/adapters.json` 原子读写 + 脱敏 |
| Adapters API | `src/server/api/adapters.ts` | IM 配置/登录/解绑 REST 路由 |
| SidecarManager | `desktop/electron/services/sidecarManager.ts` | Electron 编排 server/adapter sidecar |
| ServerRuntime | `desktop/electron/services/serverRuntime.ts` | 端口分配、健康检查、sidecar 启停 |
| AdapterSettings | `desktop/src/pages/AdapterSettings.tsx` | 桌面端 IM 配置 UI |

---

## 4. 数据流与协议

### 4.1 Client → Server 消息（WsBridge 发出）

| type | 字段 | 触发场景 |
|---|---|---|
| `user_message` | `content: string`, `attachments?: AttachmentRef[]` | 用户在 IM 发文本/附件 |
| `permission_response` | `requestId`, `allowed: boolean`, `rule?: 'always'` | 用户审批工具调用 |
| `stop_generation` | — | 用户发 `/stop` |
| `ping` | — | 30s 心跳 |

```ts
type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string        // 文件：服务端读盘注入 @"path"
  data?: string        // 图片：base64
  mimeType?: string
}
```

### 4.2 Server → Client 消息（WsBridge 接收）

| type | 字段 | 用途 |
|---|---|---|
| `connected` | `sessionId` | 连接建立 |
| `content_start` | `blockType: 'text'\|'tool_use'`, `toolName?`, `toolUseId?` | 内容块开始 |
| `content_delta` | `text?`, `toolInput?` | 流式增量 |
| `tool_use_complete` | `toolName`, `toolUseId`, `input` | 工具调用入参完整 |
| `tool_result` | `toolUseId`, `content`, `isError` | 工具执行结果 |
| `permission_request` | `requestId`, `toolName`, `input`, `description?` | 工具需要授权 |
| `message_complete` | `usage: TokenUsage` | 一轮回复结束 |
| `thinking` | `text` | 思考过程 |
| `status` | `state: ChatState`, `verb?` | 会话状态机变化 |
| `error` | `message`, `code`, `retryable?` | 错误 |
| `api_retry` | `attempt`, `maxRetries`, `retryDelayMs` | API 重试通知 |
| `streaming_fallback` | `cause` | 流式降级 |
| `session_title_updated` | `sessionId`, `title` | 会话标题更新 |

`ChatState = 'idle' | 'thinking' | 'compacting' | 'tool_executing' | 'streaming' | 'permission_pending'`

### 4.3 服务端 → CLI（SDK WS）

通过 `/sdk/:sessionId` 通道，消息格式遵循 Anthropic SDK 协议：

- `{type: 'user', message: {role: 'user', content}}` — 注入用户输入
- `{type: 'control_response', response: {subtype: 'success', request_id, response: {behavior: 'allow'|'deny', ...}}}` — 权限响应

### 4.4 CLI → 服务端（SDK WS，stream-json）

CLI 以 `--output-format stream-json --include-partial-messages` 启动，推送：

- `stream_event` (message_start / content_block_start / content_block_delta / content_block_stop)
- `assistant` (完整 assistant 消息)
- `user` (含 tool_result)
- `control_request` (can_use_tool)
- `result` (turn 结束)
- `system` (各种 subtype)

服务端 `translateCliMessage` 把这些翻译成 §4.2 的 ServerMessage 转发给客户端。

### 4.5 持久化数据

| 文件路径 | 用途 | 写入方式 |
|---|---|---|
| `~/.claude/adapters.json` | 平台配置 + 配对状态 + pairedUsers | tmp+rename, mode 0o600 |
| `~/.claude/adapter-sessions.json` | chatId↔(sessionId, workDir) 映射 | tmp+rename |
| `~/.claude/whatsapp-auth/default/` | Baileys auth state (creds.json + signal keys) | Baileys 内部 |
| `~/.claude/im-downloads/{platform}/{sessionId}/` | IM 附件下载落地 | tmp.part+rename, 24h GC |
| `~/.claude/uploads/{sessionId}/` | 服务端把 base64 图片写盘位置 | 服务端管理 |

---

## 5. 核心算法

### 5.1 WsBridge handlerChains 串行化（防竞态命脉）

```ts
// adapters/common/ws-bridge.ts:200-213
const prev = this.handlerChains.get(chatId) ?? Promise.resolve()
const next = prev
  .catch(() => {}) // 上游错误不传染
  .then(() => Promise.resolve().then(() => handler(msg)))
  .catch((err) => {
    console.error(`[WsBridge] Handler error on ${chatId}:`, err)
  })
this.handlerChains.set(chatId, next)
```

**作用**：保证同一 chatId 的服务端消息按到达顺序串行处理，避免"慢 handler 还在 await im.message.create，快 handler 已读到旧状态"的 race。

### 5.2 SessionRecovery 6 步算法

```
1. sessionStore.get(chatId) → stored
   若空且 bridge 有旧 session → resetStaleBridge + clearTransientState → 返回 null
2. 若 bridge.sessionId !== stored.sessionId → resetSession + clearTransientState
3. 若 bridge 已对该 sessionId OPEN → 直接复用，跳过 HTTP 校验
4. httpClient.sessionExists(stored.sessionId) → GET /api/sessions/:id
   404 → 删 store + resetStaleBridge + clearTransientState → 返回 null
5. bridge.connectSession + onServerMessage + waitForOpen
6. 返回 entry
```

### 5.3 MessageBuffer 双触发 flush

```
append(text):
  buffer += text
  if buffer.length >= charThreshold:   // 200 字
    scheduleFlush(): 清 timer, queueMicrotask 立即 flush
  else if no timer:
    timer = setTimeout(intervalMs) → flush(false)  // 500ms

complete():
  if flushing: pendingComplete = true; await activeFlush
  else: flush(true)

flush(isComplete):
  取出 buffer → 清空 → onFlush(text, isComplete)
  finally: if pendingComplete → pendingComplete=false; flush(true)
```

### 5.4 MessageDedup LRU + TTL

```ts
tryRecord(id):
  existing = store.get(id)
  if existing && now - existing < ttlMs: return false  // 重复
  if store.size >= maxEntries: delete oldest            // LRU 驱逐
  store.set(id, now); return true

sweep():  // 1 分钟一次
  for [key, ts] of store:
    if now - ts >= ttlMs: delete key
    else: break  // Map 插入序，遇到未过期就停
```

> ⚠️ **cc-haha 原项目已知 bug（评审 S2）**：sweep 短路依赖 Map 插入序，但 `tryRecord` 在 TTL 过期后对**已存在的 key** 调用 `set` **不会改变插入顺序**（JS Map 语义：对已存在 key 的 set 只更新 value，不移动位置）。这导致 re-record 后该 entry 仍停留在旧的靠前位置，但携带新鲜时间戳；sweep 扫到它时会提前 `break`，**其后所有更晚插入但可能已过期的 entry 全部被跳过**。
>
> **复刻修复方案**（二选一）：
> 1. re-record 时先 `delete(id)` 再 `set(id, now)`，让 key 移动到末尾
> 2. sweep 不做短路，改为完整扫描（5000 entries 的扫描成本可忽略，<1ms）
>
> 推荐方案 2，简单且无副作用。详见 §9.1 补充测试用例。

### 5.5 Pairing 配对码生成与校验

```ts
// 生成
SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'  // 排除 0/O/1/I/L
code = 6 位 crypto.randomInt(SAFE_ALPHABET.length)
// 总空间 32^6 ≈ 10^9，配合 5min/5次速率限制，爆破不可行

// 校验
tryPair(messageText, senderInfo, platform):
  if isRateLimited(userId): return false              // 5min/5次
  if !pairing.code || expired: return false
  if messageText.trim().toUpperCase() !== pairing.code.toUpperCase():
    recordFailedAttempt(userId); return false
  // 成功：push pairedUsers（去重）+ 清空 pairing.code（一次性）
  writeConfigFile(file); return true
```

> ⚠️ **cc-haha 原项目速率限制的局限（评审 S3/L4）**：
> - `failedAttempts` 是模块级单例 Map（`pairing.ts:21`），**5 个 adapter 进程各自独立计数**——攻击者在 5 个平台各试 5 次 = 25 次/5min，而非 5 次
> - 按 `userId` 维度计数，攻击者用不同 userId 即可绕过
> - 进程内 Map，**重启清零**
>
> **复刻修复方案**：
> 1. 速率限制改为按 IP + userId 双维度（IM 平台能拿到发送方 IP 时优先用 IP）
> 2. 持久化到 `adapters.json` 的 `pairing.failedAttempts` 字段（配对成功或窗口过期后清空）
> 3. 或在 §6.1 step 3 修复 WS 鉴权后，此风险自然降级（攻击者无法直接连 WS，必须走 IM 配对）

### 5.6 HttpClient matchProject 4 级匹配

```
1. query 是 allowedProjectRoots 内的绝对路径 → 直接返回
2. parseInt(query) 成 1-based 索引 → projects[num-1]
3. projectName.toLowerCase() === query → 精确匹配
4. projectName/realPath contains query → 1 个返回 project，多个返回 ambiguous
```

### 5.7 AttachmentStore GC 双阈值

```
walk(root):
  普通文件: now - mtime > 24h → 删除
  .part 孤儿: now - mtime > 10min → 删除（更激进）
返回 {removed, bytes}
```

### 5.8 ImageBlockWatcher 跨 feed 缓冲

```ts
feed(chunk):
  buffer += chunk
  IMAGE_RE.lastIndex = 0
  for each match:
    classify(target) → PendingUpload
    fingerprint(kind:target) → 若新指纹 → push out + accumulated
  buffer = buffer.slice(lastConsumedEnd)  // 保留未消费尾部
  if buffer.length > 4096: buffer = buffer.slice(-2048)  // 防爆内存
```

**关键**：跨 feed 边界的 `![alt](src)` 也能识别（测试 `image-block-watcher.test.ts:55-64` 是验收用例）。

### 5.9 飞书 CardKit 5 步协议

```
1. cardkit.v1.card.create()           → card_id
2. im.message.create(interactive, card_id) → message_id
3. cardkit.v1.cardElement.content() × N   → 增量更新 element（sequence 单调递增）
4. cardkit.v1.card.settings(streaming_mode=false) → 关闭流式（否则按钮无响应）
5. cardkit.v1.card.update()           → 全量替换为最终态
```

**约束**：streamCardContent 传完整累计文本而非 delta；sequence 必须单调递增。

### 5.10 钉钉 AI 卡片 QPS 令牌桶

```
CARD_API_MAX_QPS = 20
QPS_BACKOFF_DURATION_MS = 2000

请求前: 等待令牌
403 + body contains 'QpsLimit' → triggerBackoff(2000ms)
退避期间所有请求排队等待
```

---

## 6. 实现步骤

### 6.1 阶段一：服务端桥接（Week 1-2）

**目标**：搭建 HTTP+WS 服务器，能启动 CLI 子进程并通过 WS 双向通信。

1. **创建 `src/server/index.ts`**
   - `Bun.serve` 启动 HTTP+WS，监听 `127.0.0.1:{port}`（**默认绑 127.0.0.1**；若需 `0.0.0.0` 必须配合 step 3 的强制鉴权）
   - 路由：`/ws/:sessionId`（client channel）、`/sdk/:sessionId`（sdk channel）、`/api/*`（REST）
   - sessionId 格式校验：`/^[0-9a-zA-Z_-]{1,64}$/`

2. **实现 `src/server/ws/events.ts`**
   - 定义 `ClientMessage` / `ServerMessage` 联合类型（见 §4.1、§4.2）

3. **实现 `src/server/ws/handler.ts`**（⚠️ **相对 cc-haha 原项目的安全增强**）
   - `open`：按 channel 分流
     - **sdk channel**：校验 `sdkToken`（与 cc-haha 一致）
     - **client channel**：**强制 token 鉴权**（cc-haha 原项目默认无鉴权，是安全漏洞 S1）。复刻时 `/ws/:sessionId` 必须从查询参数 `?token=` 或 `Sec-WebSocket-Protocol` 提取 clientToken，与 server 在创建会话时下发给 adapter 的 token 比对；不匹配立即 `ws.close(1008, 'Invalid client token')`
     - 鉴权 token 由 `POST /api/sessions` 创建会话时一并返回，adapter sidecar 通过 env `ADAPTER_SESSION_TOKENS` 或 `/api/sessions` 响应体获取
   - `message`：路由 `user_message` / `permission_response` / `stop_generation` / `ping`
   - `close`：宽限期清理（有挂起权限请求 → 30min，否则按 managed settings）
   - `translateCliMessage`：CLI stream-json → ServerMessage 的 switch
   - `replayPendingPermissionRequests`：客户端重连时重放挂起权限请求
   - `bindClientSessionOutput`：注册 CLI 输出回调链

4. **实现 `src/server/services/conversationService.ts`**
   - `startSession`：`Bun.spawn` CLI 子进程，参数含 `--sdk-url ws://.../sdk/{sid}?token=...`、`--output-format stream-json --include-partial-messages`
   - `sendMessage`：组装 SDK `user` 消息发到 CLI
   - `respondToPermission`：组装 `control_response` 发到 CLI
   - `handleSdkPayload`：解析 CLI 输出，缓存到 `sdkMessages`（最近 40 条），识别 `control_request(can_use_tool)` 写入 `pendingPermissionRequests`
   - `onOutput`：注册输出回调

5. **实现 `src/server/services/adapterService.ts`**
   - 原子读写 `~/.claude/adapters.json`（tmp+rename, mode 0o600）
   - ⚠️ **评审 L2 跨平台**：`mode 0o600` 仅在 Linux/macOS 生效，Windows NTFS 下 `fs.chmod` 是 no-op。`adapters.json` 含 botToken / appSecret 等敏感凭据，Windows 复刻时需额外用 `icacls` 限制文件 ACL（仅当前用户可读写），不能仅依赖 0o600
   - 脱敏敏感字段（botToken / appSecret 等返回 `******`）
   - 配对码掩码

6. **实现 `src/server/api/adapters.ts`**
   - `GET /api/adapters`（脱敏返回）
   - `PUT /api/adapters`（浅合并，白名单顶层 key）
   - `POST /api/adapters/{plat}/login/{start,poll}`（扫码绑定）
   - `POST /api/adapters/{plat}/unbind`（解绑）
   - `POST /api/sessions`（创建会话，返回 sessionId）

**验收**：用 wscat 连 `/ws/:sessionId`，发 `user_message`，能看到 CLI 流式输出 `content_delta`。

### 6.2 阶段二：Common 适配器内核（Week 3-4）

**目标**：实现平台无关的 10 个 common 模块，覆盖测试。

1. **`adapters/common/config.ts`** — 配置加载
   - 类型层级：`AdapterConfig` 顶层 + 5 个平台子配置
   - 优先级：env > `~/.claude/adapters.json` > 默认值
   - `resolveUserDefaultWorkDir`：5 级候选目录 fallback

2. **`adapters/common/ws-bridge.ts`** — WS 桥接（核心）
   - `sessions: Map<chatId, Session>`、`handlers: Map<chatId, MessageHandler>`、`handlerChains: Map<chatId, Promise>`
   - 常量：`HEARTBEAT_INTERVAL_MS=30_000`、`RECONNECT_BASE_MS=1000`、`RECONNECT_MAX_MS=30_000`、`MAX_RECONNECT_ATTEMPTS=10`
   - API：`connectSession`、`sendUserMessage`、`sendPermissionResponse`、`sendStopGeneration`、`onServerMessage`、`waitForOpen`、`resetSession`、`destroy`
   - 心跳：每 30s 给所有 OPEN 连接发 `ping`
   - 重连：close code 非 1000 → 指数退避 `min(1000×2^(n-1), 30000)`
   - 防过期消息：`if (this.sessions.get(chatId) !== session) return`
   - ⚠️ **评审 M3 优化**：`handlerChains` 是长生命周期 Promise 链，chatId 活跃时每条消息都 `then` 挂一个新 Promise，链不断增长。**每 100 条消息截断一次**：当 `handlerChains.get(chatId)` 的链深度 ≥ 100 时，`Promise.resolve()` 重置链头（此时旧链的 finally 已全部执行完，重置安全）。避免长期运行后单 chatId 链深度无界增长导致 GC 压力

3. **`adapters/common/chat-queue.ts`** — 24 行 Promise 链串行化

4. **`adapters/common/session-store.ts`** — 持久化映射
   - 每次 `get` 都 `refresh()` 重新 load 文件（多进程协同关键）
   - 原子写：tmp+rename
   - 反查：`deleteBySessionId`
   - ⚠️ **评审 M2 优化**：`refresh()` 每次都 `fs.readFileSync` + `JSON.parse`，高频消息场景下 IO 与解析开销显著。**增加 mtime 缓存**：缓存 `{ mtime: number, data: StoreData }`，`refresh()` 先 `fs.statSync` 取 mtime，与缓存 mtime 相等则跳过 read+parse，直接复用缓存 data；mtime 变化才重新 load。**安全性保证**：mtime 是文件系统级修改时间戳，其他进程的原子写（tmp+rename）必然改变 mtime，因此缓存不会读到过期数据，多进程协同语义与原实现等价
   - ⚠️ **评审 L1 安全**：`deleteBySessionId` 反查删除时，若两个 chatId 误绑同一 sessionId（理论上不应出现，但脏数据场景可能发生），**必须遍历全部 entry 逐条比对**，不能找到第一个就 break；删除后立即原子写回，避免部分删除导致的不一致
   - ⚠️ **评审 M5 + L2 跨平台**：Windows 下 `path.resolve` 可能产生 UNC 前缀 `\\?\C:\...`，`fs.realpathSync` 在某些 Windows 版本上对 UNC 路径行为不一致。复刻时：(1) 统一用 `path.normalize` + 显式剥离 `\\?\` 前缀；(2) `fs.chmod(path, 0o600)` 在 Windows 上是 **no-op**（NTFS 不支持 Unix 权限位），**不能依赖 0o600 做访问控制**，敏感文件（`adapters.json` 含 botToken / appSecret）需额外用 `icacls`（Windows）或限制目录 ACL；Linux/macOS 下 0o600 仍有效

5. **`adapters/common/session-recovery.ts`** — 6 步恢复算法
   - 依赖注入（Pick 类型）便于测试

6. **`adapters/common/message-buffer.ts`** — 流式节流
   - 默认 `INTERVAL_MS=500`、`CHAR_THRESHOLD=200`
   - `pendingComplete` 处理 complete 时正在 flush 的边界

7. **`adapters/common/message-dedup.ts`** — LRU + TTL
   - `TTL_MS=10min`、`MAX_ENTRIES=5000`、`SWEEP_INTERVAL_MS=60s`

8. **`adapters/common/permission.ts`** — 权限命令解析
   - 显式命令：`/^(\/(allow|always|allow-always|deny)\s+(\S+))/i`
   - 单 pending 快捷回复：`1/allow/y/允许` 等
   - 回调解析：`permit:{requestId}:{yes|always|no}`

9. **`adapters/common/pairing.ts`** — 配对授权
   - `SAFE_ALPHABET` + `crypto.randomInt` 生成 6 位码
   - `CODE_TTL_MS = 60min`
   - `RATE_LIMIT_WINDOW_MS = 5min`、`RATE_LIMIT_MAX_ATTEMPTS = 5`
   - `isPaired` 默认关闭（allowedUsers 和 pairedUsers 都空时返回 false）

10. **`adapters/common/http-client.ts`** — REST 客户端
    - `DEFAULT_TIMEOUT_MS = 30_000`（AbortController + setTimeout）
    - `createSession`、`sessionExists`、`listRecentProjects`、`matchProject`、`getGitInfo`、`getTasksForSession`、`listSessions`、`listProviders`、`listModels`、`listSkills`
    - `allowedProjectRoots` 默认拒绝（空数组 = 拒绝任意绝对路径）

11. **`adapters/common/format.ts`** — 消息格式化
    - `splitMessage`：段落→换行→句号→空格→硬切 优先级
    - `convertMarkdownTablesToBullets`：识别 fenced code block 跳过
    - `formatToolUse`、`formatPermissionRequest`、`formatImHelp`、`formatImStatus`

12. **`adapters/common/attachment/`** — 附件子系统
    - `attachment-types.ts`：类型定义
    - `attachment-limits.ts`：`IMAGE_MAX_BYTES=10MB`、`FILE_MAX_BYTES=30MB`、`IMAGE_MIME_WHITELIST`（拒 HEIC）
    - `attachment-store.ts`：sanitize + 碰撞避让 + tmp.part+rename + 双阈值 GC（24h / 10min）
    - `image-block-watcher.ts`：正则 + DJB2 指纹 + 跨 feed 缓冲
    - ⚠️ **评审 M5 跨平台**：`AttachmentStore.resolve` 的 path sanitize 须额外处理 Windows UNC 前缀 `\\?\`：`path.resolve` 在 Windows 上可能返回 UNC 形式，`path.relative` 计算 `../../etc/passwd` 逃逸检测时需先 normalize 到统一形式（剥离 `\\?\` 前缀）；否则 sanitize 判断可能失效
    - ⚠️ **评审 M4 优化 + §11.1 风险升级**：cc-haha 原项目 GC 仅在 `save()` 写入时触发（懒清理），若 adapter 长时间无新附件写入，过期文件不会被清理，磁盘持续增长。**复刻必须增加每小时主动 GC 定时器**：`setInterval(() => this.gc(), 60 * 60 * 1000)`，独立于写入路径主动扫描清理过期文件；adapter 关闭时 `clearInterval`

13. **`adapters/common/logger.ts`** — 结构化日志（⚠️ **评审 L7：从 §11.2 改进建议提升为实现要求**）
    - cc-haha 原项目全用 `console.log`，无级别 / 无结构化字段，生产排查困难
    - 复刻实现轻量 logger：`{ ts, level, platform, chatId?, sessionId?, event, msg, fields? }` JSON 单行输出到 stderr
    - 级别：`debug | info | warn | error`，通过 env `LOG_LEVEL` 控制（默认 `info`）
    - 关键埋点：WS 连接 / 断开 / 重连、ChatQueue 入队 / 出队、SessionRecovery 各步、MessageBuffer flush、Permission 审批、Pairing 成功 / 失败、Attachment GC 清理数
    - 不引入第三方依赖（pino 等），保持 common 层零服务端依赖原则

14. **`adapters/common/health.ts`** — adapter 健康检查（⚠️ **评审 L8：从 §11.2 改进建议提升为实现要求**）
    - cc-haha 原项目无主动健康检查，adapter 卡死（如 WS 重连耗尽 10 次后放弃）时 server 无法感知
    - 复刻在 adapter sidecar 内启动轻量 HTTP 服务（端口由 env `HEALTH_PORT` 指定，或复用 server 分配），暴露：
      - `GET /health`：返回 `{ status: 'ok'|'degraded'|'down', platform, wsConnected, activeChatIds, uptime, lastError? }`
      - `status=down` 触发条件：WS 重连耗尽 / CLI 子进程崩溃未恢复 / 心跳超时
    - server 侧（`serverRuntime.ts`）每 30s 轮询各 adapter `/health`，连续 3 次 `down` 则重启 adapter sidecar

15. **协议版本协商**（⚠️ **评审 L8 关联：从 §11.2 改进建议提升为实现要求**）
    - cc-haha 原项目 WS 协议无版本字段，未来升级 ClientMessage / ServerMessage 类型会破坏旧 client
    - 复刻在 WS 连接握手阶段协商版本：
      - client 连接时查询参数带 `?proto=v1`（或 `Sec-WebSocket-Protocol: cc-im-v1`）
      - server `open` handler 校验版本：支持则放行，不支持则 `ws.close(1011, 'Unsupported protocol version')` 并在响应头 `X-Supported-Versions: v1,v2` 列出支持的版本
      - 当前版本 `v1`，对应 §4.1 / §4.2 定义的 ClientMessage / ServerMessage 联合类型；未来 `v2` 升级时通过版本分支路由 handler

**验收**：每个模块独立测试通过（参考 cc-haha 的 `__tests__/` 用例）；结构化日志可被 `jq` 解析；`GET /health` 在 adapter 正常 / WS 断开 / CLI 崩溃三种状态下返回正确 status；协议版本不匹配时 server 正确拒绝并返回支持版本列表。

### 6.3 阶段三：Telegram 适配器（Week 5）

**目标**：跑通第一个 IM 平台，验证 common 层设计。

1. **`adapters/telegram/index.ts`** 主入口
   - `new Bot(config.telegram.botToken)` + `bot.start()` 长轮询
   - 装配 common 模块（参考 §3.2 装配样板）
   - `bot.on('message:text')` / `bot.on(['message:photo', ...])` / `bot.on('callback_query:data')`

2. **流式实现**：占位消息 + `editMessageText` 循环
   - `status=thinking` 发占位 `'💭 思考中...'`
   - `content_delta` 进 MessageBuffer，flush 时 `planTelegramStreamingUpdate` 切段
   - `message_complete` 一次性 editMessageText 最终文本

3. **权限卡片**：`InlineKeyboard` 三按钮（`permit:{requestId}:{yes|always|no}`）

4. **媒体**：`getFile` + `fetch /file/bot<token>/<file_path>` 下载；`sendPhoto(InputFile)` 上传

5. **菜单**：`setMyCommands` 同步 14 个命令

6. **扩展命令**：`/resume`、`/provider`、`/model`、`/skills`（InlineKeyboard 分页选择器）

**验收**：Telegram 私聊 bot，发"你好"，能看到流式回复；发 `/projects` 能切换项目；权限请求能点按钮审批。

### 6.4 阶段四：飞书适配器（Week 6-8，最复杂，⚠️ **相对 cc-haha 原项目排期延长 1 周**）

> **评审 M1 调整说明**：原排期 2 周内需完成 CardKit 5 步协议 + 状态机 + FlushController + markdown 5 步优化 + 媒体 + 权限卡片 + 错误降级共 8 个子模块，密度过高。拆分为两个子阶段，整体延长到 3 周；下游 §6.5、§6.6 相应顺延 1 周。

**子阶段 4a（Week 6）：CardKit 协议 + 状态机 + 流式内核**

1. **`adapters/feishu/index.ts`** — Lark WSClient 启动
2. **`cardkit.ts`** — CardKit 5 步协议封装（create → patch → patch… → finalize → complete）
3. **`streaming-card.ts`** — 状态机 `idle→creating→streaming→finalizing→completed`
4. **`flush-controller.ts`** — `CARDKIT_MS=100` / `PATCH_MS=1500` / 长间隔批量 300ms
5. **`markdown-style.ts`** — 5 步优化（代码块占位、H1~H3 降级、`<br>` 间距、空行压缩、代码块还原）

**子阶段 4a 验收**：飞书私聊 bot 能收到流式卡片渐进更新，markdown 渲染正确，代码块 / 标题 / 间距符合预期。

**子阶段 4b（Week 7-8）：媒体 + 权限卡片 + 错误降级 + 联调**

6. **`media.ts`** — `im.messageResource.get` 下载、`im.image.create` / `im.file.create` 上传
7. **权限卡片**：Schema 2.0 + column_set 三按钮 + 跨目录红色警告（`path-safety.ts`）
8. **错误降级**：230020 跳帧、230099+11310 表格超限禁用流式中间帧、连续失败 3 次禁用流式
9. **联调**：与 common 层（WsBridge / MessageBuffer / SessionRecovery）端到端跑通，覆盖 §9.3 飞书 golden path 全部 10 个用例

**子阶段 4b 验收**：飞书私聊 bot，流式卡片渐进更新，权限卡片按钮可点，表格 ≤ 3 张，附件上传 / 出站图片正常，错误降级路径已验证。

### 6.5 阶段五：钉钉 / 微信 / WhatsApp（Week 9-10）

按复杂度从低到高：WhatsApp → 微信 → 钉钉。

1. **WhatsApp**：Baileys + 多文件 auth state + QR 扫码 + 累积一次性发送 + presence composing
2. **微信**：HTTP 长轮询 + typing 指示器（5s 重发）+ AES-128-ECB 媒体解密 + context_token
3. **钉钉**：dingtalk-stream DWClient + AI 卡片（固定模板 ID `02fcf2f4-...`）+ QPS 令牌桶 + sessionWebhook + 权限卡片模板
   - ⚠️ **评审 L3**：`sessionWebhook` 有 72h 过期限制（见 §11.1 风险条目），长会话场景下可能失效。复刻时 adapter 须：(1) 检测 sessionWebhook 调用返回的特定错误码（如 webhook 已失效），(2) **主动通过 dingtalk-stream 通道给用户发提示**"会话已过期，请重新发一条消息以刷新通道"，(3) 用户下次发消息时从 IM 事件 payload 重新提取 sessionWebhook 并持久化；不能静默失败导致用户无响应

**验收**：5 个平台都能私聊 bot 完成"对话→权限审批→切换项目"完整流程。

### 6.6 阶段六：桌面端集成（Week 11）

1. **`desktop/electron/services/sidecarManager.ts`** — `createServerPlan` / `createAdapterPlan`
2. **`desktop/electron/services/serverRuntime.ts`** — 端口动态分配 + 健康检查 + sidecar 启停
3. **`desktop/sidecars/claude-sidecar.ts`** — 统一入口（server / cli / adapters 三模式共用二进制）
4. **`desktop/src/pages/AdapterSettings.tsx`** — 配置 UI（5 个 tab + 配对管理 + 扫码绑定按钮）

**验收**：桌面端 `设置 → IM 接入` 能配置 5 个平台，生成配对码，扫码绑定，启动 sidecar。

---

## 7. 依赖清单

### 7.1 运行时依赖

| 包 | 版本 | 用途 | 必需 |
|---|---|---|---|
| `ws` | `^8.18.0` | WebSocket 客户端（WsBridge） | ✅ |
| `grammy` | `^1.42.0` | Telegram Bot 框架 | Telegram |
| `@larksuiteoapi/node-sdk` | `^1.60.0` | 飞书官方 SDK（WSClient） | 飞书 |
| `dingtalk-stream` | `2.1.4` | 钉钉 Stream SDK | 钉钉 |
| `@whiskeysockets/baileys` | `7.0.0-rc.9` | WhatsApp Web 协议 | WhatsApp |
| `qrcode` | latest | 生成扫码绑定二维码 | 微信/WhatsApp |

### 7.2 overrides（安全升级）

| 包 | 版本 | 原因 |
|---|---|---|
| `follow-redirects` | `^1.16.0` | 安全升级 |
| `protobufjs` | `^7.5.5` | 安全升级 |

### 7.3 devDependencies

| 包 | 版本 | 用途 |
|---|---|---|
| `@types/ws` | `^8.5.0` | ws 类型 |
| `bun-types` | `latest` | Bun 运行时类型 |

### 7.4 运行时

- **Bun** >= 1.0（`bun install`、`bun run`、`bun test`）
- **Node.js** 内置模块：`fs`、`path`、`os`、`crypto`、`fetch`（全局）
- ⚠️ **评审 M6 Bun / Node 兼容性**：cc-haha 原项目深度依赖 Bun 运行时（`Bun.serve`、`Bun.spawn`、`bun-types`），**不能直接在 Node.js 上运行**。若复刻方需支持 Node.js 运行时，须替换：(1) `Bun.serve` → `http` + `ws` 组合或 `fastify`；(2) `Bun.spawn` → `child_process.spawn`；(3) `bun-types` → `@types/node`；(4) `bun test` → `vitest` 或 `jest`；(5) Bun 专有 API（如 `Bun.file`、`Bun.password`）→ Node 等价实现。**建议复刻方仍以 Bun 为主运行时**，避免大规模 API 替换引入新 bug；Node.js 兼容作为"可选目标"在 MVP 后再评估

### 7.5 Common 层依赖极简

common 层只依赖 `ws` 一个外部包，其余 4 个 SDK 都是平台 adapter 用。复刻时 common 层可独立发布。

---

## 8. 配置规范

### 8.1 配置优先级

```
环境变量 > ~/.claude/adapters.json > 默认值
```

### 8.2 配置文件结构（`~/.claude/adapters.json`）

```jsonc
{
  "serverUrl": "ws://127.0.0.1:3456",
  "defaultProjectDir": "/Users/me/projects",
  "pairing": {
    "code": "ABC234",          // 6 位，一次性
    "expiresAt": 1719600000000,
    "createdAt": 1719596400000
  },
  "telegram": {
    "botToken": "123456:ABC-DEF...",
    "allowedUsers": [12345678],     // 白名单 user id
    "pairedUsers": [                // 配对过的用户
      { "userId": "87654321", "displayName": "Alice", "pairedAt": 1719596400000 }
    ],
    "defaultWorkDir": "/Users/me/work"
  },
  "feishu": {
    "appId": "cli_xxx",
    "appSecret": "xxx",
    "encryptKey": "...",             // 可选
    "verificationToken": "...",      // 可选
    "streamingCard": false,          // 是否用 CardKit 流式卡片
    "allowedUsers": ["ou_xxx"],
    "pairedUsers": [],
    "defaultWorkDir": ""
  },
  "dingtalk": {
    "clientId": "dingxxx",
    "clientSecret": "xxx",
    "endpoint": "https://api.dingtalk.com",
    "permissionCardTemplateId": "",  // 可选，空则用文本命令审批
    "allowedUsers": [],
    "pairedUsers": [],
    "defaultWorkDir": ""
  },
  "wechat": {
    "accountId": "wx_xxx",
    "botToken": "xxx",
    "baseUrl": "https://ilinkai.weixin.qq.com",
    "userId": "xxx",
    "allowedUsers": [],
    "pairedUsers": [],
    "defaultWorkDir": ""
  },
  "whatsapp": {
    "accountJid": "15551234567@s.whatsapp.net",
    "authDir": "~/.claude/whatsapp-auth/default",
    "allowedUsers": [],
    "pairedUsers": [],
    "defaultWorkDir": ""
  }
}
```

### 8.3 环境变量总表

| 环境变量 | 平台 | 取值 | 必填 |
|---|---|---|---|
| `ADAPTER_SERVER_URL` | 共享 | `ws://127.0.0.1:3456` | ✅ |
| `ADAPTER_DEFAULT_PROJECT_DIR` | 共享 | 全局默认工作目录 | 否 |
| `CLAUDE_ADAPTER_DEFAULT_WORK_DIR` | 共享 | 同上候选 | 否 |
| `CLAUDE_CONFIG_DIR` | 共享 | `~/.claude` 位置 | 否 |
| `TELEGRAM_BOT_TOKEN` | Telegram | BotFather token | Telegram |
| `FEISHU_APP_ID` | 飞书 | `cli_xxx` | 飞书 |
| `FEISHU_APP_SECRET` | 飞书 | 应用密钥 | 飞书 |
| `FEISHU_ENCRYPT_KEY` | 飞书 | 事件加密密钥 | 否 |
| `FEISHU_VERIFICATION_TOKEN` | 飞书 | 事件校验 token | 否 |
| `DINGTALK_CLIENT_ID` | 钉钉 | appKey | 钉钉 |
| `DINGTALK_CLIENT_SECRET` | 钉钉 | appSecret | 钉钉 |
| `DINGTALK_STREAM_ENDPOINT` | 钉钉 | `https://api.dingtalk.com` | 否 |
| `DINGTALK_PERMISSION_CARD_TEMPLATE_ID` | 钉钉 | 权限卡片模板 ID | 否 |
| `WECHAT_ACCOUNT_ID` | 微信 | 网关返回 | 微信 |
| `WECHAT_BOT_TOKEN` | 微信 | 网关返回 | 微信 |
| `WECHAT_BASE_URL` | 微信 | `https://ilinkai.weixin.qq.com` | 否 |
| `WECHAT_USER_ID` | 微信 | 网关返回 | 微信 |
| `WHATSAPP_AUTH_DIR` | WhatsApp | `~/.claude/whatsapp-auth/default` | 否 |
| `WHATSAPP_ACCOUNT_JID` | WhatsApp | `15551234567@s.whatsapp.net` | WhatsApp |
| `DINGTALK_REGISTRATION_BASE_URL` | 钉钉(服务端) | `https://oapi.dingtalk.com` | 否 |
| `DINGTALK_REGISTRATION_SOURCE` | 钉钉(服务端) | `DING_DWS_CLAW` | 否 |

### 8.4 服务端启动参数

```bash
# 推荐：默认绑 127.0.0.1（最安全）
claude-sidecar server --app-root <path> --host 127.0.0.1 --port {动态}

# 若需 0.0.0.0（如 H5 远程访问），必须配合 --auth-required 强制鉴权
claude-sidecar server --app-root <path> --host 0.0.0.0 --port {动态} --auth-required
```

> ⚠️ cc-haha 原项目生产环境固定绑 `0.0.0.0`（`sidecarManager.ts:8` 的 `SERVER_BIND_HOST`），且 `/ws/:sessionId` 默认无鉴权。复刻时**必须**：要么改绑 `127.0.0.1`，要么启用 `--auth-required` + client channel token 校验（见 §6.1 step 3）。两者至少满足其一。

### 8.5 Adapter sidecar 启动参数

```bash
claude-sidecar adapters --app-root <path> [--feishu] [--telegram] [--wechat] [--dingtalk] [--whatsapp]
# env: ADAPTER_SERVER_URL=ws://127.0.0.1:{port}
```

### 8.6 平台账号申请要点

| 平台 | 申请方式 | 关键凭据 | 是否需公网回调 |
|---|---|---|---|
| Telegram | @BotFather `/newbot` | botToken | 否（长轮询） |
| 飞书 | 一键模板 `https://open.feishu.cn/page/openclaw?form=multiAgent` | appId + appSecret | 否（WSClient） |
| 钉钉 | 开发者后台创建应用 + 启用 Stream 模式 | clientId + clientSecret | 否（Stream） |
| 微信 | 桌面端扫码绑定 ilink bot | accountId + botToken + userId | 否（长轮询） |
| WhatsApp | 桌面端扫码绑定（Baileys linked device） | auth state 文件 | 否（WhatsApp Web） |

---

## 9. 测试流程

### 9.1 单元测试（参考 cc-haha `adapters/common/__tests__/`）

每个 common 模块都有对应测试，**必须覆盖以下关键用例**：

| 模块 | 关键测试用例 | 验收点 |
|---|---|---|
| WsBridge | `__tests__/ws-bridge.test.ts:118-155` | 串行化顺序 `start:1,end:1,start:2,end:2,start:3,end:3` |
| WsBridge | `__tests__/ws-bridge.test.ts:218-245` | 重连前旧 socket 的 stale 消息不派发 |
| MessageBuffer | `__tests__/message-buffer.test.ts:58-99` | complete 时正在 flush 的边界（pendingComplete） |
| MessageDedup | sweep 完整扫描（**修复 cc-haha S2 bug**） | 5000 entries 完整扫描 < 1ms，无提前 break |
| MessageDedup | re-record 后 sweep 仍能清理过期 entry（**新增，对应 S2**） | 见下方补充用例 |
| SessionStore | `__tests__/session-store.test.ts:62-70` | 进程 A 删除后进程 B 立即读到 null |
| SessionRecovery | `__tests__/session-recovery.test.ts:121-144` | bridge 已 OPEN 时跳过 HTTP 校验（checked===0） |
| Pairing | 5min/5 次速率限制 | 第 6 次失败被拒 |
| Pairing | 配对码一次性使用 | 成功后 pairing.code 清空 |
| HttpClient | `__tests__/http-client.test.ts:78-96` | allowedProjectRoots 空时拒绝绝对路径 |
| AttachmentStore | `__tests__/attachment-store.test.ts:35-43` | `../../etc/passwd` 不逃出 root |
| AttachmentStore | `__tests__/attachment-store.test.ts:78-92` | 50 次连续 resolve 全部唯一 |
| AttachmentLimits | HEIC 被拒 | `image/heic` 返回 unsupported_mime |
| ImageBlockWatcher | `__tests__/image-block-watcher.test.ts:55-64` | 跨 feed 边界的图片标记能识别 |
| Permission | 多 pending 时只接受显式命令 | `__tests__/permission.test.ts:26-28` |

**补充测试用例（对应评审 S2 — MessageDedup re-record 后 sweep 失效 bug）**：

```ts
// adapters/common/__tests__/message-dedup.test.ts
describe('sweep 在 re-record 场景下仍能清理过期 entry (S2 回归)', () => {
  it('re-record 已存在 key 后，sweep 仍能扫到其后过期的 entry', () => {
    const dedup = new MessageDedup({ ttlMs: 1000, maxEntries: 5000 });
    const t0 = Date.now();
    dedup.tryRecord('a');               // t0 插入
    dedup.tryRecord('b');               // t0 插入
    dedup.tryRecord('c');               // t0 插入

    // 等 'a' 过期
    vi.advanceTimersByTime(1100);
    dedup.tryRecord('a');               // re-record 'a'，cc-haha 原实现不移动 Map 位置

    // 再让 'b'、'c' 也过期，但 'a' 重新新鲜
    vi.advanceTimersByTime(900);        // 此时 'a' 距 re-record 仅 900ms（未过期），'b'/'c' 距原始插入 2000ms（已过期）

    dedup.sweep();

    // cc-haha 原实现：sweep 遇到 'a'（新鲜）就 break，'b'/'c' 永远不被清理 ❌
    // 复刻修复后：完整扫描，'b'/'c' 被正确删除 ✅
    expect(dedup.has('a')).toBe(true);
    expect(dedup.has('b')).toBe(false);
    expect(dedup.has('c')).toBe(false);
  });
});
```

运行：`cd adapters && bun test`

### 9.2 集成测试

1. **服务端 WS 测试**：用 wscat 连 `/ws/:sessionId`，发 `user_message`，验证收到 `content_delta` 流
2. **CLI 桥接测试**：启动 server + CLI 子进程，验证 `translateCliMessage` 翻译正确
3. **配对流程测试**：生成配对码 → IM 发码 → 验证 `pairedUsers` 写入 + `pairing.code` 清空
4. **会话恢复测试**：杀掉 adapter 进程 → 重启 → 验证 `restoreStoredSessionBinding` 恢复 WS 连接
5. **权限审批测试**：触发 `can_use_tool` → 验证 `permission_request` 推送 → 回复 `permission_response` → 验证 CLI 继续/中止

### 9.3 端到端测试（每个平台）

针对每个 IM 平台执行以下 golden path：

1. **配对**：桌面端生成配对码 → IM 私聊 bot 发码 → 收到"配对成功"
2. **首次对话**：发"你好" → 收到流式回复（Telegram editMessage / 飞书 CardKit 卡片 / 钉钉 AI 卡片 / 微信/WhatsApp 一次性）
3. **权限审批**：让 Claude 调用 Bash → 收到权限卡片/文本 → 点"允许" → Claude 继续执行
4. **切换项目**：发 `/projects` → 收到项目列表 → 选择项目 → 收到"已切换"
5. **新会话**：发 `/new` → 收到"新会话已创建"
6. **状态查询**：发 `/status` → 收到当前会话状态
7. **停止生成**：发 `/stop` → 流式停止
8. **清空上下文**：发 `/clear` → 上下文清空
9. **附件上传**（Telegram/飞书/WhatsApp）：发图片 → Claude 能识别图片内容
10. **出站图片**（Telegram/飞书/WhatsApp）：让 Claude 输出 markdown 图片 → IM 收到独立图片消息

### 9.4 边界与故障测试

1. **WS 断线重连**：杀掉 server → adapter 指数退避重连 → 恢复后消息不丢
2. **CLI 崩溃**：杀掉 CLI 子进程 → server 检测 → 通知客户端 error → 下次 user_message 重启 CLI
3. **配对码过期**：等 60min 后发码 → 拒绝
4. **速率限制**：连续 5 次错码 → 第 6 次拒绝
5. **超大附件**：发 > 10MB 图片 → 拒收并提示
6. **跨目录权限**：Claude 试图写工作目录外 → 飞书卡片变红 + 警告
7. **表格超限**（飞书）：让 Claude 输出 > 3 张表格 → 禁用流式中间帧
8. **QPS 限流**（钉钉）：连续触发 AI 卡片更新 → 403 QpsLimit → 退避 2s
9. **WhatsApp 凭据失效**：手机端登出 → adapter 收到 401 → 提示重新扫码
10. **群聊不处理**：在群里 @bot → 不响应（仅私聊）

### 9.5 性能测试

1. **并发用户**：10 个 chatId 同时发消息 → 验证 ChatQueue 串行不阻塞其他 chatId。**验收：其他 chatId 首字节延迟 < 200ms**（串行仅影响同 chatId）
2. **长文本流式**：Claude 输出 10000 字 → 验证 MessageBuffer 节流 + splitMessage 切分。**验收：IM 端首帧延迟 < 1s，总耗时 < Claude 原始流式耗时的 1.2 倍**
3. **附件 GC**：写入 100 个附件 → 等 24h → GC 清理。**验收（M4 增强后）：每小时主动 GC 定时器触发，24h 后过期文件 100% 清理，磁盘占用回落到写入前基线**
4. **WS 连接池**：100 个 chatId 同时在线 → 验证心跳 + 内存占用。**验收：常驻内存 < 100MB，心跳无遗漏（连续 1h 无 close 事件）**
5. **SessionStore mtime 缓存（M2 新增）**：单 chatId 连续 1000 次 `get()`，对比无缓存基线。**验收：mtime 未变时 read+parse 次数 = 1（仅首次），平均 `get()` 延迟下降 ≥ 80%**；mtime 变化时立即重新 load，数据无过期
6. **handlerChains 截断（M3 新增）**：单 chatId 连续发送 500 条消息，对比无截断基线。**验收：链深度始终 ≤ 100（截断后重置），500 条消息后 Promise 对象数量 < 无截断基线的 1/4，无内存持续增长**

---

## 10. 复刻注意事项

### 10.1 必须保留的设计

1. **WsBridge.handlerChains 串行化** — IM 集成防竞态命脉，任何复刻都必须实现
2. **SessionStore.refresh 多进程协同语义** — 多 adapter 进程协同关键。**禁止内容缓存**（会读到过期数据），但 **mtime 缓存允许**（评审 M2）：`statSync` 取 mtime，与缓存 mtime 相等才跳过 read+parse；其他进程的原子写必然改变 mtime，协同语义等价
3. **SessionRecovery 依赖注入（Pick 类型）** — 测试友好
4. **MessageBuffer.pendingComplete** — 处理 complete 时正在 flush 的边界
5. **MessageDedup 的去重语义（LRU 驱逐 + TTL 过期）** — 必须保留；但 **sweep 短路优化不要保留**（cc-haha 原项目在 re-record 场景下已失效，详见 §5.4 评审 S2）。复刻时改为完整扫描（5000 entries < 1ms），并在 §9.1 补充回归测试
6. **Pairing 的 SAFE_ALPHABET + crypto.randomInt + 速率限制** — 三件套缺一不可
7. **HttpClient.allowedProjectRoots 默认拒绝** — 安全关键，不要改成"空=允许任意"
8. **AttachmentStore 的 .part 孤儿 grace period** — 区别对待 .part 和正常文件
9. **ImageBlockWatcher 的 buffer 保留未消费尾部** — 跨 feed 边界必须能识别
10. **原子写统一 tmp+rename** — SessionStore、pairing、AttachmentStore 都用
11. **isPaired 默认关闭** — allowedUsers 和 pairedUsers 都空时返回 false
12. **WS 重连退避参数** — base=1s、max=30s、最多 10 次，实战调优过

### 10.2 可调整的部分

1. **协议契约**：common 用镜像类型保持零依赖；若想强类型可直接 import 服务端类型（引入循环依赖风险）
2. **MessageBuffer 阈值**：默认 500ms/200 字，飞书 CardKit 用 100ms，钉钉用 1200ms
3. **流式实现**：飞书 CardKit 5 步协议复杂，可考虑退到 `im.message.patch` 降级路径
4. **菜单同步**：Telegram 用 setMyCommands，其他平台用文本匹配
5. **权限卡片**：飞书 Schema 2.0 自构建、钉钉 AI 卡片模板、Telegram InlineKeyboard、微信/WhatsApp 纯文本

### 10.3 已知文档缺口（cc-haha 原项目）

- `.env.example` **不包含任何 IM 相关环境变量**
- `docs/guide/env-vars.md` 也只列了模型/API 变量
- IM 配置主要通过桌面端 UI 写入 `~/.claude/adapters.json`，环境变量仅用于本地开发或 sidecar 注入

复刻时应在 `.env.example` 补全 §8.3 的所有环境变量。

---

## 11. 风险与改进建议

### 11.1 已识别风险

| 风险 | 严重度 | 来源 | 缓解措施 |
|---|---|---|---|
| **服务端 WS 通道无鉴权 + 绑 0.0.0.0** | **高** | cc-haha 原项目 `sidecarManager.ts:8` 固定 `SERVER_BIND_HOST='0.0.0.0'`，`/ws/:sessionId` 默认无鉴权（仅 `/sdk/:sessionId` 校验 token）。同网段攻击者可直接注入 `user_message`、响应权限请求（allow 任意工具） | **复刻必须修复**（见 §6.1 step 3）：① 默认绑 `127.0.0.1`；② 若必须 `0.0.0.0`，强制 `--auth-required` + client channel token 校验。此为 MVP 硬性前提 |
| WhatsApp 个人号风控 | 高 | Baileys 模拟 WhatsApp Web，可能被封号 | 文档明确警告，建议用小号；考虑改用 WhatsApp Business Cloud API |
| **Baileys RC 版本稳定性** | **高** | `@whiskeysockets/baileys` 锁定 `7.0.0-rc.9`（RC 版本），API 可能在正式版发布前 breaking change；WhatsApp 协议升级时 RC 版本通常最先失效 | 锁定版本 + 跟进 7.0.0 正式版；WhatsApp 适配器标为"最佳 effort，不保证 SLA"；放在 MVP 第四阶段 |
| 微信 ilink 网关稳定性 | 中 | 非官方协议，可能变更 | 监控 `ilinkai.weixin.qq.com` 可用性；准备 wechaty 备选方案 |
| 钉钉 sessionWebhook 72h 过期 | 中 | 长会话可能失效 | adapter 检测 sessionWebhook 调用返回特定错误码时，主动给用户发"会话已过期，请重新发消息"提示 |
| 飞书 CardKit API 变更 | 中 | 230020/230099 等错误码可能演化 | 错误降级路径已覆盖主要错误码 |
| **配对码速率限制 per-platform per-process 易绕过** | **中** | 速率限制是模块级单例 Map（`pairing.ts:21`），5 个 adapter 进程各自独立计数；且按 userId 维度，攻击者可用不同 userId 绕过；进程重启清零 | 速率限制改为按 IP + userId 双维度，持久化到 `adapters.json`；与"WS 无鉴权"风险联动放大（见上） |
| **配对码共享 + 配对成功持久访问** | **中** | 6 位码空间 32^6≈10^9，但配合上一条速率限制绕过可枚举；配对成功后 `pairedUsers` 持久写入，即使改码也无效 | 配对成功后记录 `pairedAt`，提供"撤销配对"API（已有 unbind，需在 UI 暴露）；与 WS 鉴权修复联动后此风险降为低 |
| 附件 GC 只在启动时跑 | 中 | 长运行 adapter 不会自动清理，24h 保留期内可能累积数 GB | **已提升为实现要求**（见 §6.2 step 12）：`setInterval(() => store.gc(), 60*60*1000)` |
| `pairedUsers` 共享同一 `pairing.code` | 低 | 一个码可配多个平台用户 | 设计如此，适合"一码配多 bot"场景；修复 WS 鉴权后影响可控 |

### 11.2 改进建议

> 注：标注 ✅ 的项已在本次评审迭代中提升为 §6.2 实现要求，不再作为"可选改进"。

1. **WhatsApp 改用 Cloud API**：避免个人号风控，但需公网 webhook（与"无公网回调"设计冲突，需权衡）
2. ✅ **配对码持久化速率限制**：写入 `adapters.json`，防重启清零（**已并入 §5.5 复刻修复方案 + §11.1 风险条目**）
3. ✅ **附件 GC 定时器**：每小时跑一次（**已提升为 §6.2 item 12 实现要求，评审 M4**）
4. ✅ **WS 服务端鉴权**：为 `/ws/:sessionId` 加 token（**已提升为 §6.1 step 3 实现要求，评审 S1**）
5. **统一流式抽象**：把飞书 CardKit、Telegram editMessage、钉钉 AI 卡片抽象成 `StreamingSink` 接口，降低平台 adapter 复杂度
6. **配置校验**：`loadConfig` 时用 zod schema 校验，避免运行时类型错误
7. ✅ **可观测性**：加 structured logging（JSON 格式），便于 ELK 采集（**已提升为 §6.2 item 13 实现要求，评审 L7**）
8. ✅ **健康检查**：adapter sidecar 暴露 `/health` 端点，供 server 监控（**已提升为 §6.2 item 14 实现要求，评审 L8**）
9. **重连退避抖动**：指数退避加随机抖动（jitter），防止多个 adapter 同时重连风暴
10. ✅ **协议版本协商**：WS 连接时协商协议版本，便于未来升级（**已提升为 §6.2 item 15 实现要求，评审 L8 关联**）

### 11.3 复刻优先级建议

如果资源有限，建议按以下优先级分阶段复刻：

**MVP（最小可用）**：
- 服务端 + common 层 + Telegram 适配器
- 覆盖：对话、权限审批、切换项目、配对

**第二阶段**：
- 飞书适配器（国内企业用户多）
- 桌面端配置 UI

**第三阶段**：
- 钉钉适配器
- 微信适配器

**第四阶段**：
- WhatsApp 适配器
- 附件支持
- 出站图片支持

### 11.4 评审迭代记录（v1.0 → v1.1）

> 本节记录基于技术评审报告对方案文档的迭代修正，按问题编号映射到具体改动位置。

**P0（严重 — 必须修复）**

| 编号 | 问题 | 迭代动作 | 改动位置 |
|---|---|---|---|
| S1 | 服务端 WS 通道 `/ws/:sessionId` 默认无鉴权 + 绑 `0.0.0.0`，同网段攻击者可注入 user_message / 响应权限请求 | 修正安全事实：新增 ⚠️ 安全提示；§6.1 step 1 强调默认绑 127.0.0.1；step 3 新增 client channel 强制 token 鉴权要求；§8.4 拆为两种启动命令；§11.1 新增高危风险条目 | §1.1、§6.1 step 1/3、§8.4、§11.1 |
| S2 | MessageDedup sweep 短路在 re-record 场景下失效（JS Map 对已存在 key 的 set 不移动插入序），导致后续过期 entry 永不清理 | §5.4 新增 bug 说明 + 两种修复方案（推荐完整扫描）；§9.1 新增 re-record 后 sweep 回归测试用例；§10.1 第 5 条改为"sweep 短路不要保留"；§3.1 算法描述改为"完整扫描" | §3.1、§5.4、§9.1、§10.1 |
| S3 | Pairing 速率限制为模块级单例 Map，5 个 adapter 进程各自独立计数（实际 25 次/5min），且按 userId 维度可绕过，进程内 Map 重启清零 | §5.5 新增速率限制局限说明 + 三种修复方案（IP+userId 双维度 / 持久化 / WS 鉴权修复后自然降级）；§11.1 配对码速率限制从低升为中 | §5.5、§11.1 |

**P1（中等 — 建议修复）**

| 编号 | 问题 | 迭代动作 | 改动位置 |
|---|---|---|---|
| M1 | 飞书 2 周内完成 8 个子模块（CardKit 协议+状态机+FlushController+markdown 优化+媒体+权限卡片+错误降级）密度过高 | §6.4 拆分为 4a（Week 6 协议+状态机+流式内核）/ 4b（Week 7-8 媒体+权限+降级+联调），整体延长到 3 周；§6.5 顺延到 Week 9-10，§6.6 顺延到 Week 11 | §6.4、§6.5、§6.6 |
| M2 | SessionStore.refresh 每次都 readFileSync+JSON.parse，高频场景 IO 开销显著 | §6.2 item 4 新增 mtime 缓存优化（statSync 取 mtime，未变则跳过 read+parse）；§10.1 第 2 条澄清"内容缓存禁止、mtime 缓存允许"；§9.5 新增量化验收标准 | §6.2 item 4、§10.1、§9.5 |
| M3 | handlerChains 是长生命周期 Promise 链，活跃 chatId 链深度无界增长 | §6.2 item 2 新增每 100 条消息截断机制；§9.5 新增量化验收标准 | §6.2 item 2、§9.5 |
| M4 | 附件 GC 仅在 save() 写入时触发（懒清理），长运行 adapter 磁盘持续增长 | §6.2 item 12 新增每小时主动 GC 定时器；§11.1 附件 GC 风险从低升为中（标记为已提升为实现要求）；§9.5 强化验收标准 | §6.2 item 12、§11.1、§9.5 |
| M5 | Windows 下 path.resolve 可能产生 UNC 前缀 \\?\，sanitize 逃逸检测可能失效 | §6.2 item 4（SessionStore）+ item 12（AttachmentStore）新增 UNC 前缀剥离要求 | §6.2 item 4/12 |
| M6 | cc-haha 深度依赖 Bun 运行时，不能直接在 Node.js 运行 | §7.4 新增 Bun/Node 兼容性替换清单（Bun.serve→http+ws、Bun.spawn→child_process 等），建议仍以 Bun 为主运行时 | §7.4 |
| M7 | ChatQueue 与 handlerChains 都做串行化，分工不清 | §3.1 组件表澄清：ChatQueue 串行化入站事件（IM→adapter），handlerChains 串行化出站 WS 消息（adapter→server），两者不可合并 | §3.1 |

**P2（轻微 — 可选改进，部分已提升为实现要求）**

| 编号 | 问题 | 迭代动作 | 改动位置 |
|---|---|---|---|
| L1 | SessionStore.deleteBySessionId 反查删除时，若两个 chatId 误绑同一 sessionId 可能部分删除 | §6.2 item 4 新增安全要求：必须遍历全部 entry 逐条比对，不能找到第一个就 break | §6.2 item 4 |
| L2 | Windows NTFS 下 fs.chmod 0o600 是 no-op，不能依赖 Unix 权限位做访问控制 | §6.1 step 5 + §6.2 item 4 新增 Windows ACL 要求（icacls 限制敏感文件访问） | §6.1 step 5、§6.2 item 4 |
| L3 | 钉钉 sessionWebhook 72h 过期，长会话失效后 adapter 静默失败 | §6.5 钉钉条目新增主动通知要求：检测失效→通过 dingtalk-stream 通道提示用户→下次消息刷新 webhook | §6.5 |
| L4 | 配对码速率限制持久化（与 S3 关联） | 已并入 §5.5 修复方案 + §11.1 风险条目 | §5.5、§11.1 |
| L7 | 结构化日志（原 §11.2 改进建议 #7） | 提升为 §6.2 item 13 实现要求（logger.ts，JSON 单行 stderr，4 级别，关键埋点清单） | §6.2 item 13、§11.2 |
| L8 | adapter 健康检查 + 协议版本协商（原 §11.2 改进建议 #8/#10） | 提升为 §6.2 item 14（/health 端点 + server 30s 轮询 + 连续 3 次 down 重启）+ item 15（WS 握手协议版本协商） | §6.2 item 14/15、§11.2 |

> **未单独处理项**：L5、L6 在评审摘要中未提供具体描述，本轮迭代无法定位；若后续补充评审报告提供详细信息，将在 v1.2 迭代中补齐。

**§11.2 改进建议状态汇总**：原 10 条改进建议中，5 条已提升为实现要求（#2 配对码持久化、#3 附件 GC、#4 WS 鉴权、#7 结构化日志、#8 健康检查、#10 协议版本协商——注 #2/#3/#4 在 P0/P1 中已处理，#7/#8/#10 在 P2 中提升），剩余 5 条（#1 WhatsApp Cloud API、#5 统一流式抽象、#6 配置校验、#9 重连退避抖动）保留为可选改进。

---

## 附录 A：关键文件路径索引

### cc-haha 源码（分析基准）

| 模块 | 路径 |
|---|---|
| Common 层 | `D:\AI\cc-haha\adapters\common\` |
| Telegram | `D:\AI\cc-haha\adapters\telegram\` |
| 飞书 | `D:\AI\cc-haha\adapters\feishu\` |
| 钉钉 | `D:\AI\cc-haha\adapters\dingtalk\` |
| 微信 | `D:\AI\cc-haha\adapters\wechat\` |
| WhatsApp | `D:\AI\cc-haha\adapters\whatsapp\` |
| 服务端 | `D:\AI\cc-haha\src\server\` |
| 桌面端编排 | `D:\AI\cc-haha\desktop\electron\services\` |
| Sidecar 入口 | `D:\AI\cc-haha\desktop\sidecars\claude-sidecar.ts` |
| 配置 UI | `D:\AI\cc-haha\desktop\src\pages\AdapterSettings.tsx` |
| IM 文档 | `D:\AI\cc-haha\docs\im\` |

### 关键代码片段索引

| 功能 | 文件:行号 |
|---|---|
| WsBridge 串行化 | `adapters/common/ws-bridge.ts:200-213` |
| WsBridge 重连退避 | `adapters/common/ws-bridge.ts:269-292` |
| WsBridge 心跳 | `adapters/common/ws-bridge.ts:294-302` |
| ChatQueue 全部实现 | `adapters/common/chat-queue.ts:11-23` |
| SessionStore 原子写 | `adapters/common/session-store.ts:75-81` |
| SessionRecovery 主流程 | `adapters/common/session-recovery.ts:36-83` |
| MessageBuffer flush | `adapters/common/message-buffer.ts:69-99` |
| MessageDedup tryRecord | `adapters/common/message-dedup.ts:24-40` |
| Permission 文本解析 | `adapters/common/permission.ts:13-42` |
| Pairing 配对码生成 | `adapters/common/pairing.ts:68-74` |
| Pairing tryPair | `adapters/common/pairing.ts:98-140` |
| Config workDir fallback | `adapters/common/config.ts:172-187` |
| HttpClient 超时 | `adapters/common/http-client.ts:90-97` |
| HttpClient matchProject | `adapters/common/http-client.ts:156-200` |
| HttpClient 路径白名单 | `adapters/common/http-client.ts:374-385` |
| format splitMessage | `adapters/common/format.ts:39-65` |
| AttachmentStore 原子写 | `adapters/common/attachment/attachment-store.ts:73-79` |
| AttachmentStore GC | `adapters/common/attachment/attachment-store.ts:82-120` |
| ImageBlockWatcher feed | `adapters/common/attachment/image-block-watcher.ts:50-81` |
| 协议契约（服务端） | `src/server/ws/events.ts:11-92` |
| WS handler open | `src/server/ws/handler.ts:175-213` |
| translateCliMessage | `src/server/ws/handler.ts:1434-1949` |
| 权限请求翻译 | `src/server/ws/handler.ts:1700-1716` |
| CLI 输出转发 | `src/server/ws/handler.ts:2437-2463` |
| 服务端启动 | `src/server/index.ts:157-239` |
| Telegram 装配 common | `adapters/telegram/index.ts:50-68` |
| Telegram 权限卡片 | `adapters/telegram/index.ts:482-496` |
| 飞书 CardKit 5 步 | `adapters/feishu/cardkit.ts:13-18` |
| 飞书 StreamingCard 状态机 | `adapters/feishu/streaming-card.ts:117-256` |
| 钉钉 AI 卡片 QPS | `adapters/dingtalk/ai-card.ts:220-280` |
| 微信长轮询 | `adapters/wechat/index.ts:578-603` |
| WhatsApp Baileys 启动 | `adapters/whatsapp/index.ts:589-618` |
| Sidecar 编排 | `desktop/electron/services/serverRuntime.ts:81-110` |
| Adapter 启动 | `desktop/sidecars/claude-sidecar.ts:54-187` |

---

## 附录 B：5 平台能力对比表

| 维度 | Telegram | 飞书 | 钉钉 | 微信 | WhatsApp |
|---|---|---|---|---|---|
| 启动方式 | grammY 长轮询 | Lark WSClient | dingtalk-stream | HTTP 长轮询 | Baileys WhatsApp Web |
| 鉴权 | Bot Token | App ID+Secret | Client ID+Secret | bot_token+QR | AuthState+QR |
| 监听端口 | 否 | 否 | 否 | 否 | 否 |
| 消息格式 | 纯文本+表格降级 | CardKit markdown | AI 卡片+markdown | 纯文本 | 纯文本+部分内联 |
| 流式实现 | editMessage 循环 | CardKit 5 步 | PUT /card/streaming | 3s 积累+一次性 | 累积+一次性 |
| 流式节流 | 默认 500ms/200字 | 100ms/1500ms | 1200ms/200ms | 3000ms/200ms | 无 |
| 媒体上传 | ✅ | ✅ | ❌ | ❌ | ✅ |
| 媒体下载 | ✅ | ✅ | ✅ | ✅(AES解密) | ✅ |
| 权限卡片 | InlineKeyboard | Schema 2.0 卡片 | AI 卡片模板 | 纯文本 | 纯文本 |
| 命令菜单 | setMyCommands | 文本匹配 | 文本匹配 | 文本匹配 | 文本匹配 |
| 出站图片 | ✅ | ✅ | ❌ | ❌ | ✅ |
| 群聊支持 | 否 | 否 | 否 | 否 | 否 |
| 主要限制 | 4096 字符 | 表格≤3、H1~H3 不可用 | 20 QPS | 媒体需 AES 解密 | 个人号风控 |
| chatId | 数字 | ou_/oc_ | dingtalk:dm: | from_user_id | @s.whatsapp.net |

---

## 附录 C：API 端点清单

| 方法 | 端点 | 说明 |
|---|---|---|
| `GET` | `/api/adapters` | 读取配置（脱敏） |
| `PUT` | `/api/adapters` | 更新配置（浅合并） |
| `POST` | `/api/adapters/wechat/login/start` | 微信扫码绑定 |
| `POST` | `/api/adapters/wechat/login/poll` | 轮询微信扫码 |
| `POST` | `/api/adapters/wechat/unbind` | 解绑微信 |
| `POST` | `/api/adapters/whatsapp/login/start` | WhatsApp 扫码 |
| `POST` | `/api/adapters/whatsapp/login/poll` | 轮询 WhatsApp 扫码 |
| `POST` | `/api/adapters/whatsapp/unbind` | 解绑 WhatsApp |
| `POST` | `/api/adapters/dingtalk/unbind` | 解绑钉钉 |
| `POST` | `/api/adapters/dingtalk/registration/begin` | 钉钉扫码注册 |
| `POST` | `/api/adapters/dingtalk/registration/poll` | 轮询钉钉扫码 |
| `POST` | `/api/sessions` | 创建 Claude 会话 |
| `GET` | `/api/sessions/:id` | 检查会话是否存在 |
| `GET` | `/api/sessions/recent-projects` | 列出最近项目 |
| `GET` | `/api/sessions/:id/git-info` | 会话 Git 信息 |
| `GET` | `/api/sessions` | 分页列出会话 |
| `GET` | `/api/tasks/lists/:id` | 任务计数 |
| `GET` | `/api/providers` | 列出 LLM Provider |
| `POST` | `/api/providers/:id/activate` | 切换 Provider |
| `GET` | `/api/models` | 列出模型 |
| `PUT` | `/api/models/current` | 切换模型 |
| `GET` | `/api/skills?cwd=...` | 列出 Skills |
| `WS` | `/ws/:sessionId` | 客户端 WS 桥接 |
| `WS` | `/sdk/:sessionId?token=...` | CLI 子进程 WS |

---

**方案版本**：v1.1（基于技术评审报告迭代，详见 §11.4）
**分析基准**：cc-haha 仓库（`D:\AI\cc-haha`）
**完成日期**：2026-07-06
**迭代日期**：2026-07-07
