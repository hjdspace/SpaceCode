## Problem Statement

SpaceCode 用户希望在 NAT 后面的桌面端环境中，无需公网回调 / ngrok / 公网 IP，即可通过日常使用的 IM 平台（Telegram、飞书、钉钉、微信、WhatsApp）远程与 Claude Code 对话、切换项目、审批工具权限。当前 SpaceCode 仅有 H5 WebUI 远程访问能力，缺少 IM 平台接入，用户无法在手机端通过熟悉的 IM 工具与 AI 编码助手交互。

## Solution

在 SpaceCode 中集成 IM 远程接入能力，采用「长连接拉取 + 本地 WS 桥接 + sidecar 进程隔离」三层设计：

1. **IM Server（服务端层）**：在 Electron 主进程中扩展 HTTP+WS 服务器，复用现有 Engine 抽象管理 Claude Code CLI 子进程，通过 WS 双向通信协议桥接 IM 适配器与引擎
2. **Common 适配器内核（公共层）**：平台无关的共享模块，包括 WS 桥接、会话管理、消息节流去重、配对授权、权限解析、附件处理等
3. **平台适配器（适配器层）**：5 个 IM 平台的独立 sidecar 进程，各自处理平台 SDK 对接、流式消息渲染、权限卡片展示
4. **桌面端配置 UI**：在设置面板中新增 IM 接入配置页面，支持 5 平台配置、配对码生成、扫码绑定

安全增强（相对 cc-haha 原项目）：
- WS 通道默认绑 `127.0.0.1`，强制 token 鉴权
- 配对码速率限制持久化
- 附件 GC 定时器
- 结构化日志 + 健康检查端点
- 协议版本协商

## User Stories

1. 作为 SpaceCode 用户，我想在设置面板中配置 Telegram bot token，以便通过 Telegram 远程对话 Claude Code
2. 作为 SpaceCode 用户，我想在设置面板中配置飞书应用凭据，以便通过飞书远程对话 Claude Code
3. 作为 SpaceCode 用户，我想在设置面板中配置钉钉应用凭据，以便通过钉钉远程对话 Claude Code
4. 作为 SpaceCode 用户，我想在设置面板中配置微信 bot 凭据，以便通过微信远程对话 Claude Code
5. 作为 SpaceCode 用户，我想在设置面板中配置 WhatsApp 账号，以便通过 WhatsApp 远程对话 Claude Code
6. 作为 SpaceCode 用户，我想在桌面端生成配对码，以便在 IM 平台验证身份后建立安全连接
7. 作为 IM 用户，我想在 IM 私聊中发送配对码完成配对，以便获得与 Claude Code 对话的授权
8. 作为 IM 用户，我想在 IM 中发送文本消息并收到流式回复，以便实时看到 AI 的回复过程
9. 作为 IM 用户，我想在收到权限请求时通过按钮/命令审批，以便控制 AI 的工具调用行为
10. 作为 IM 用户，我想通过命令切换工作项目，以便在多个项目间灵活切换
11. 作为 IM 用户，我想通过命令创建新会话，以便开始全新的对话上下文
12. 作为 IM 用户，我想通过命令查询当前会话状态，以便了解 AI 的工作进度
13. 作为 IM 用户，我想通过命令停止生成，以便中断不需要的长时间回复
14. 作为 IM 用户，我想通过命令清空上下文，以便重置对话历史
15. 作为 IM 用户，我想发送图片附件给 Claude Code，以便 AI 能识别图片内容
16. 作为 IM 用户，我想收到 Claude Code 输出的图片，以便查看 AI 生成的可视化内容
17. 作为 SpaceCode 用户，我想在 IM 断线后自动重连，以便不丢失正在进行的对话
18. 作为 SpaceCode 用户，我想在 adapter 进程崩溃后自动恢复会话，以便不中断远程工作流
19. 作为 SpaceCode 用户，我想在 IM 平台收到结构化的权限请求卡片（如 Telegram InlineKeyboard、飞书 Schema 2.0 卡片、钉钉 AI 卡片），以便直观地审批工具调用
20. 作为 SpaceCode 用户，我想在配对码输入错误超过 5 次后被限制，以便防止暴力枚举攻击
21. 作为 SpaceCode 用户，我想在配对码过期（60 分钟）后自动失效，以便防止配对码被滥用
22. 作为 SpaceCode 用户，我想在 WhatsApp 端通过扫码绑定设备，以便无需公网回调即可使用 WhatsApp
23. 作为 SpaceCode 用户，我想在微信端通过扫码绑定 ilink bot，以便无需公网回调即可使用微信
24. 作为 SpaceCode 用户，我想在飞书端看到 CardKit 流式卡片渐进更新，以便有更好的流式阅读体验
25. 作为 SpaceCode 用户，我想在钉钉端看到 AI 卡片流式更新，以便有更好的流式阅读体验
26. 作为 SpaceCode 用户，我想在 Claude Code 试图写工作目录外的文件时收到红色警告，以便及时发现安全问题
27. 作为 SpaceCode 用户，我想发送大于 10MB 的图片时被拒收并提示，以便避免大文件处理问题
28. 作为 SpaceCode 用户，我想在 adapter 状态异常时被 server 自动重启，以便保持服务可用性
29. 作为 SpaceCode 用户，我想在桌面端查看各 adapter 的健康状态，以便监控 IM 接入运行情况
30. 作为 SpaceCode 用户，我想在 IM 中使用 /projects 命令列出可用项目并选择切换
31. 作为 IM 用户，我想在 IM 中使用 /new 命令创建新会话
32. 作为 IM 用户，我想在 IM 中使用 /status 命令查询会话状态
33. 作为 IM 用户，我想在 IM 中使用 /stop 命令停止生成
34. 作为 IM 用户，我想在 IM 中使用 /clear 命令清空上下文
35. 作为 IM 用户，我想在 IM 中使用 /help 命令查看可用命令
36. 作为 SpaceCode 用户，我想在 IM 中使用 /resume 命令恢复历史会话
37. 作为 SpaceCode 用户，我想在 IM 中使用 /provider 命令切换 LLM Provider
38. 作为 SpaceCode 用户，我想在 IM 中使用 /model 命令切换模型
39. 作为 IM 用户，我想在群聊中 @bot 时不响应（仅支持私聊），以便避免信息泄露
40. 作为 SpaceCode 用户，我想在飞书表格输出超过 3 张时自动禁用流式中间帧，以便避免 API 限制错误
41. 作为 SpaceCode 用户，我想在钉钉触发 QPS 限制时自动退避 2 秒，以便避免被限流
42. 作为 SpaceCode 用户，我想在 WhatsApp 凭据失效时收到重新扫码提示
43. 作为 SpaceCode 用户，我想在钉钉 sessionWebhook 过期时收到重新发消息提示
44. 作为 SpaceCode 用户，我想在 adapter 进程中看到结构化 JSON 日志，以便排查生产问题
45. 作为 SpaceCode 用户，我想在 WS 连接时协商协议版本，以便未来平滑升级协议

## Implementation Decisions

### 架构适配决策

- **运行时**：使用 Node.js（而非 Bun），适配 SpaceCode 现有 Electron 架构。将 cc-haha 的 Bun.serve 替换为 http+ws 组合（复用 h5Server.ts 模式），Bun.spawn 替换为 child_process.spawn（复用 sessionProcess.ts 模式）
- **引擎复用**：IM Server 复用 SpaceCode 现有的 Engine 抽象（IEngine 接口），通过 h5EngineService 模块调用引擎，不直接管理 CLI 子进程
- **进程拓扑**：Electron 主进程内嵌 IM Server（HTTP+WS）→ 各平台 adapter 作为独立子进程通过 WS 连接 IM Server → IM Server 通过 Engine 接口管理 CLI 子进程

### 模块设计

- **IM Server 模块**（electron/imServer/）：扩展 HTTP+WS 服务器，新增 /ws/:sessionId（client channel，token 鉴权）、/sdk/:sessionId（sdk channel，token 鉴权）、/api/* REST 路由
- **Common 层模块**（electron/im/adapters/common/）：平台无关内核，包含 ws-bridge、chat-queue、session-store、session-recovery、message-buffer、message-dedup、permission、pairing、http-client、config、format、attachment 子系统、logger、health
- **平台适配器**（electron/im/adapters/{telegram,feishu,dingtalk,wechat,whatsapp}/）：各平台独立实现
- **Sidecar 管理**（electron/imSidecarManager.ts）：编排 IM Server 和 adapter sidecar 进程的启停
- **配置 UI**（src/components/settings/ImSettings.vue）：IM 接入配置面板，5 个 tab + 配对管理 + 扫码绑定

### 关键算法

- **WsBridge handlerChains 串行化**：保证同一 chatId 的服务端消息按到达顺序串行处理，每 100 条消息截断一次防 GC 压力
- **SessionRecovery 6 步算法**：启动恢复 + 死会话清理，依赖注入 Pick 类型便于测试
- **MessageBuffer 双触发 flush**：500ms 定时器 + 200 字阈值，pendingComplete 处理 complete 时正在 flush 的边界
- **MessageDedup LRU+TTL**：10 分钟 TTL + 5000 条上限，完整扫描（修复 cc-haha 原项目 sweep 短路 bug）
- **Pairing 配对码**：SAFE_ALPHABET + crypto.randomInt 生成 6 位码，60 分钟过期，5min/5 次速率限制，一次性使用
- **AttachmentStore GC 双阈值**：正常文件 24h 过期，.part 孤儿 10min 过期，每小时主动 GC 定时器
- **飞书 CardKit 5 步协议**：create → patch × N → finalize → complete
- **钉钉 AI 卡片 QPS 令牌桶**：20 QPS 上限，403 退避 2s

### 安全决策

- WS client channel 强制 token 鉴权（创建会话时下发 token）
- 默认绑 127.0.0.1，如需 0.0.0.0 必须 --auth-required
- adapters.json 原子写（tmp+rename），Linux/macOS mode 0o600，Windows 用 icacls 限制 ACL
- HttpClient allowedProjectRoots 默认拒绝（空数组 = 拒绝任意绝对路径）
- 配对码速率限制改为按 IP + userId 双维度

### 协议设计

- Client → Server：user_message、permission_response、stop_generation、ping
- Server → Client：connected、content_start、content_delta、tool_use_complete、tool_result、permission_request、message_complete、thinking、status、error、api_retry、streaming_fallback、session_title_updated
- WS 握手协议版本协商：?proto=v1

### 配置

- 配置文件：~/.claude/adapters.json，优先级：env > JSON > 默认值
- 环境变量：ADAPTER_SERVER_URL、TELEGRAM_BOT_TOKEN、FEISHU_APP_ID/SECRET、DINGTALK_CLIENT_ID/SECRET 等

### i18n

- 所有 IM 相关 UI 文本在 zh-CN.ts 和 en-US.ts 中新增 im 命名空间
- 包括设置面板标签、配对码提示、状态消息等

## Testing Decisions

### 测试理念
只测试外部行为，不测试实现细节。好的测试应该验证模块的公共 API 行为，而不是内部实现路径。

### 测试缝隙 1：Common 层模块单元测试

- **模块**：ws-bridge、chat-queue、session-store、session-recovery、message-buffer、message-dedup、permission、pairing、http-client、format、attachment-store、attachment-limits、image-block-watcher
- **测试方式**：vitest 单元测试，mock 外部依赖（fs、WS、HTTP）
- **关键用例**：
  - WsBridge 串行化顺序验证（start:1,end:1,start:2,end:2,start:3,end:3）
  - WsBridge 重连前旧 socket 的 stale 消息不派发
  - MessageBuffer complete 时正在 flush 的边界（pendingComplete）
  - MessageDedup re-record 后 sweep 仍能清理过期 entry（S2 回归）
  - SessionStore 多进程协同（进程 A 删除后进程 B 立即读到 null）
  - SessionRecovery bridge 已 OPEN 时跳过 HTTP 校验
  - Pairing 5min/5 次速率限制 + 配对码一次性使用
  - HttpClient allowedProjectRoots 空时拒绝绝对路径
  - AttachmentStore ../../etc/passwd 不逃出 root
- **Prior art**：tests/composables/*.test.ts（vitest 模式）

### 测试缝隙 2：IM Server 协议集成测试

- **模块**：IM Server WS handler、CLI 消息翻译、权限路由、会话管理
- **测试方式**：vitest 集成测试，mock IEngine + mock WS client
- **关键用例**：
  - WS 连接 → 发 user_message → 收到 content_delta 流
  - 权限审批：control_request → permission_request → permission_response → control_response
  - 会话创建 → 恢复 → 清理
  - WS token 鉴权：无 token 拒绝、错误 token 拒绝、正确 token 放行
  - 协议版本协商：不支持版本拒绝并返回支持列表
- **Prior art**：electron/__tests__/*.test.ts（Node test runner 模式）

### 平台适配器 E2E 测试
每个 IM 平台的 golden path 通过手动测试验证（配对 → 首次对话 → 权限审批 → 切换项目 → 新会话 → 状态查询 → 停止生成 → 清空上下文 → 附件上传 → 出站图片），不在自动化测试覆盖范围内。

## Out of Scope

- 群聊支持（仅支持私聊）
- WhatsApp Business Cloud API（使用 Baileys 个人号方案）
- 统一流式抽象 StreamingSink 接口（保留各平台独立实现）
- 配置 zod schema 校验（使用运行时类型检查）
- 重连退避抖动 jitter（使用标准指数退避）
- engine/ 目录下 CLI 核心引擎的修改
- 构建产物（dist/、dist-electron/、release/）的直接修改

## Further Notes

- 本 PRD 基于 docs/IM-REPLICATION-PLAN.md v1.1 技术复刻方案，该方案对 cc-haha 开源项目 IM 接入子系统进行了全面技术分析
- 安全增强相对 cc-haha 原项目：WS 鉴权、配对码速率限制持久化、附件 GC 定时器、结构化日志、健康检查、协议版本协商
- MVP 优先级：服务端 + common 层 + Telegram 适配器（覆盖对话、权限审批、切换项目、配对）
- 第二阶段：飞书适配器 + 桌面端配置 UI
- 第三阶段：钉钉 + 微信适配器
- 第四阶段：WhatsApp 适配器 + 附件支持 + 出站图片
- Windows 跨平台注意：path.resolve 可能产生 UNC 前缀需剥离，fs.chmod 0o600 在 NTFS 是 no-op 需用 icacls
