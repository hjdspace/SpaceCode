# IM 集成 Issue 拆解

> 基于 PRD: docs/prds/im-integration-prd.md

## 依赖关系图

```
0a ─┬─→ 1 ──→ 2 ──→ 3 ──→ 4 (飞书)
    │         ↑    ├──→ 5 (钉钉)
0b ─┘─────────┘    ├──→ 6 (微信)
                   └──→ 7 (WhatsApp)
```

## MVP 路径: 0a + 0b → 1 → 2 → 3

---

## Slice 0a: Common 核心模块

### What to build
实现 6 个平台无关的共享逻辑模块，覆盖 WS 桥接、入站事件串行化、会话持久化、会话恢复、流式节流、消息去重。每个模块配备单元测试。

### Acceptance criteria
- [ ] ws-bridge.ts: WS 连接池 + 指数退避重连(1s→30s×10) + 30s 心跳 + handlerChains 串行化(每100条截断)
- [ ] chat-queue.ts: Promise 链入站事件串行化(24行核心逻辑)
- [ ] session-store.ts: chatId↔sessionId 持久化 + mtime 缓存 + tmp+rename 原子写 + deleteBySessionId 全遍历
- [ ] session-recovery.ts: 6 步恢复算法 + Pick 类型依赖注入
- [ ] message-buffer.ts: 500ms/200字 双触发 flush + pendingComplete 边界处理
- [ ] message-dedup.ts: LRU+TTL(10min/5000条) + 完整扫描(修复 sweep 短路 bug)
- [ ] 所有模块单元测试通过

### Blocked by
None - can start immediately

---

## Slice 0b: Common 支撑模块

### What to build
实现 8+ 个支撑模块，覆盖权限解析、配对授权、配置加载、HTTP 客户端、消息格式化、附件子系统、结构化日志、健康检查。

### Acceptance criteria
- [ ] permission.ts: 显式命令 + 单 pending 快捷回复 + 回调解析
- [ ] pairing.ts: SAFE_ALPHABET + crypto.randomInt + 60min TTL + 5min/5次速率限制 + 一次性使用
- [ ] config.ts: env > JSON > 默认值 + 5 级 workDir fallback
- [ ] http-client.ts: 30s 超时 + 4 级 matchProject + allowedProjectRoots 默认拒绝
- [ ] format.ts: 段落优先切分 + GFM 表格转 bullet
- [ ] attachment/: attachment-types + attachment-limits(10MB/30MB/MIME白名单) + attachment-store(sanitize+GC) + image-block-watcher
- [ ] logger.ts: JSON 单行 stderr + 4 级别 + LOG_LEVEL env
- [ ] health.ts: GET /health 端点 + status: ok/degraded/down
- [ ] 所有模块单元测试通过

### Blocked by
None - can start immediately

---

## Slice 1: IM Server + WS 协议 + Engine 桥接

### What to build
在 Electron 主进程中创建 IM Server（HTTP+WS），定义 ClientMessage/ServerMessage 协议类型，实现 WS handler（token 鉴权 + 协议版本协商），REST API（sessions + adapters config），桥接到现有 IEngine 接口。

### Acceptance criteria
- [ ] IM Server HTTP+WS 监听 127.0.0.1
- [ ] /ws/:sessionId client channel token 鉴权
- [ ] /sdk/:sessionId sdk channel token 鉴权
- [ ] ClientMessage/ServerMessage 联合类型定义
- [ ] translateCliMessage 将引擎事件翻译为 ServerMessage
- [ ] POST /api/sessions 创建会话并返回 sessionId + token
- [ ] GET/PUT /api/adapters 配置读写（脱敏 + 原子写）
- [ ] 协议版本协商: ?proto=v1
- [ ] 集成测试: WS 连接 → user_message → content_delta 流

### Blocked by
- Slice 0a

---

## Slice 2: Telegram 适配器

### What to build
实现 Telegram 适配器（grammY），跑通配对→对话→权限审批→切换项目完整 golden path。

### Acceptance criteria
- [ ] grammY 长轮询启动
- [ ] 流式: 占位消息 + editMessageText 循环
- [ ] 权限卡片: InlineKeyboard 3 按钮 (permit:{requestId}:{yes|always|no})
- [ ] 媒体: getFile + fetch 下载, sendPhoto 上传
- [ ] 命令菜单: setMyCommands 同步 14 个命令
- [ ] 扩展命令: /resume, /provider, /model, /skills
- [ ] 装配 common 模块
- [ ] Telegram 私聊 bot 完成 golden path

### Blocked by
- Slices 0a, 0b, 1

---

## Slice 3: Sidecar 管理 + 桌面端配置 UI

### What to build
实现 IM Sidecar 进程编排 + 桌面端 IM 设置面板（5 平台配置 + 配对管理 + 扫码绑定）+ i18n。

### Acceptance criteria
- [ ] imSidecarManager: createServerPlan / createAdapterPlan
- [ ] 端口动态分配 + 健康检查(30s 轮询) + sidecar 启停
- [ ] ImSettings.vue: 5 tab + 配对管理 + 扫码绑定按钮
- [ ] i18n: zh-CN + en-US im 命名空间
- [ ] IPC 暴露 + 集成到 SettingsPanel
- [ ] 桌面端设置→配置→生成配对码→启动 sidecar

### Blocked by
- Slices 1, 2

---

## Slice 4: 飞书适配器
### Blocked by: Slices 0a, 0b, 1, 3

## Slice 5: 钉钉适配器
### Blocked by: Slices 0a, 0b, 1, 3

## Slice 6: 微信适配器
### Blocked by: Slices 0a, 0b, 1, 3

## Slice 7: WhatsApp 适配器
### Blocked by: Slices 0a, 0b, 1, 3
