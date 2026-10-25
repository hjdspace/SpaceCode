# 语音输入（Voice Input）产品规格

> 状态：ready-for-agent。决策依据见 ADR 0014（本地 sherpa-onnx，主进程 worker 推理）与 `CONTEXT.md` 的 Voice Input 一节。

## Problem Statement

桌面用户经常需要口述一段中文或中英混说的内容（会议结论、代码注释、给 Agent 的指令），用键盘敲太慢。当前 SpaceCode 的桌面端没有任何麦克风入口；`engine/` 里已有的云端 STT 只在 CLI 内运行，桌面渲染层既拿不到它，也不该为了转写把音频发到第三方服务。

用户要的是一条不离开本机的快速通道：按一下说话，文字实时出现在自己正在打字的那个输入框里。他不希望录音打断已有草稿，不希望说完就自动发出去，也不希望为了语音再装一套独立的客户端。

## Solution

在聊天输入框提供一个常驻麦克风按钮，并支持全局 `Alt+V` 切换录音。录音期间输入框进入只读，实时转写持续追加在被冻结的草稿之后；停止时只把**终稿**写回输入框、不自动发送；取消则完整恢复录音前的草稿。识别完全在本机完成（sherpa-onnx + 固定版本的中英双语流式模型），模型在首次使用时下载一次，之后离线可用。桌面端所有 ChatInput 都能作为录音目标；H5/移动端不出现该入口。

## User Stories

1. As a desktop user, I want to dictate into the chat composer with one click, so that I can produce a message faster than typing.
2. As a Chinese developer, I want Chinese and English mixed speech recognized in one pass, so that I can say "把这个 handler 改成 async" without switching modes.
3. As a developer, I want punctuation inserted by the model itself, so that the transcript is usable without manual cleanup.
4. As a privacy-conscious user, I want recognition to happen entirely on my machine, so that my voice never leaves the device.
5. As an offline user, I want voice input to work after the model has been downloaded once, so that a flaky network does not block me.
6. As a first-time user, I want to be told the download size and asked for confirmation before 127MB of data is fetched, so that I am not surprised by the cost.
7. As a user on a slow network, I want download progress with transferred/total bytes and speed, so that I can tell a slow download from a stuck one.
8. As a user on a slow network, I want an interrupted download to resume instead of restarting, so that a 45-minute download is not wasted by one disconnect.
9. As a user, I want to cancel a download and retry later, so that I stay in control of my bandwidth.
10. As a user, I want to see the installed model's size and remove it to reclaim disk space, so that 169MB is not silently permanent.
11. As a user whose model files were damaged or partially deleted, I want the app to detect it before recording and offer a reinstall, so that I do not get a crash or a silent failure.
12. As a user, I want a microphone button in every chat composer (main chat, design pane, mini chat, scheduled-task modal), so that the entry point is where I am typing.
13. As a user, I want to click the button once to start and once to stop, so that I do not have to hold a key while speaking.
14. As a user, I want a global `Alt+V` shortcut that works even when the window is hidden, so that I can start dictating from anywhere.
15. As a user, I want `Alt+V` to target the composer I last clicked into, so that the transcript lands where I was about to type.
16. As a user, I want my existing draft preserved while I speak, so that recording does not destroy what I already wrote.
17. As a user, I want the composer locked during recording, so that keystrokes and IME composition cannot interleave with the live transcript.
18. As a user, I want the live transcript to update continuously while I speak, so that I can see recognition is working.
19. As a user, I want the live transcript to be provisional, so that revision jitter while speaking is expected rather than destructive.
20. As a user, I want stopping to commit only the final transcript into the composer, so that the durable text is exactly what I reviewed.
21. As a user, I want stopping to never send the message, so that I can review and edit before sending.
22. As a user, I want pressing Escape during recording to cancel and discard the transcript, so that a mistaken recording leaves no trace.
23. As a user, I want recording to stop automatically after 5 seconds of silence, so that I do not leave the mic open by accident.
24. As a user, I want switching chat sessions or leaving the composer to cancel the recording, so that audio never leaks into another conversation.
25. As a user, I want a clear error when microphone permission is denied, with guidance to Windows settings, so that I know how to unblock myself.
26. As a user, I want a clear error if the microphone disappears mid-recording, so that I can retry instead of wondering why nothing is happening.
27. As a user, I want a "no speech detected" outcome when the recording was silent, so that an empty commit is not silent confusion.
28. As a user, I want the entry point hidden on H5/mobile, so that I am not offered a feature the platform cannot run.
29. As a user, I want the app to keep running if the speech engine fails to load, so that voice input is the only thing that breaks.
30. As a user in a disabled/limited state (during a send, while optimizing a prompt), I want the mic button to reflect that it cannot be used, so that I do not start a recording that cannot commit.
31. As a user, I want all new text and errors in my language (zh-CN/en-US), so that the feature is consistent with the rest of the app.
32. As a user, I want the model pinned to the exact release asset that was verified, so that a same-family but incompatible export can never be installed.

## Implementation Decisions

### 1. Speech Model（识别模型）资产管理

**Manifest.** 内置一份不可变清单：资产名、压缩包字节数与 SHA256、必需的四个文件（encoder / decoder / joiner / tokens）及其精确字节数、模型版本。清单是唯一的版本与哈希来源；UI 与下载器不得自行拼装这些常量。

**位置与状态.** 模型安装到 `userData` 下的语音模型目录。状态机为 `missing → downloading → verifying → extracting → installed`，失败回到 `missing`（保留 `.part`），安装后损坏为 `corrupt`。运行期只做廉价校验：四个文件存在且大小与清单一致；完整 SHA256 只在安装时算一次。这落实了 "integrity-checked before use" 的可执行含义，避免每次录音前哈希 169MB。

**下载.** 源顺序：直连 GitHub 发布资产 → 复用仓库既有的 GitHub 镜像前缀（结果与 RTK 下载器口径一致）→ 用户在设置中填写的自定义完整 URL。写 `.part` 临时文件，HTTP `Range` 续传；服务端以 `200` 忽略 Range 时从头写。连接超时快速失败并切换源；传输停滞窗口内无任何进度才判定卡住。下载、校验、解包均可取消；取消保留 `.part`，移除模型时连同 `.part` 与压缩包一起删除。

**校验与原子就位.** 压缩包 SHA256 不符 → 删除该来源的产物、报错、允许重试，绝不进入解包。校验通过后用系统 `tar` 解包到临时目录，只保留四个必需文件，核对大小，再原子改名到最终目录并写入安装清单（版本、哈希、文件表、安装时间）；压缩包在成功后删除。

**移除.** 删除模型目录并回到 `missing`；录音进行中不允许移除。

### 2. 主进程语音会话（Voice Session）

新增 `voice` IPC 命名空间，沿用仓库的通道定义 → preload 桥 → handler 注册三段式约定，不新增手写 channel 字符串。

调用面：

- `getModelStatus()` → `{ state, version, installedBytes }`
- `installModel({ customUrl? })` → 完成时返回成功/失败；下载进度与阶段走事件
- `cancelInstall()`
- `removeModel()`
- `startSession({ sessionId })` → `{ ok, sampleRate: 16000 }`；模型缺失/损坏/加载失败在此返回错误
- `sendAudio({ sessionId, pcm })` → 单向发送；payload 为 100ms / 1600 samples 的 PCM16 `ArrayBuffer`
- `stopSession({ sessionId })` → `{ text }`；先把已送音频全部喂完并收口，再返回终稿
- `cancelSession({ sessionId })` → 丢弃本次会话，不返回文本

事件面：

- `onPartial({ sessionId, text })`
- `onSessionState({ sessionId, state, error? })`，状态为 `loading | recording | finalizing | ended | failed`
- `onModelProgress({ phase: 'downloading' | 'verifying' | 'extracting', transferred, total, percent })`
- `onToggleRequest()`，由全局 `Alt+V` 触发

**范围约束.** 全局同时只允许一个 Recording Session；新的 `startSession` 先取消旧的。未知或已结束 `sessionId` 的音频与停止请求被忽略，不抛错。

**长语音.** 识别器开启 endpoint；每次 endpoint 后重置流并把分段文本按空格拼接，停止时返回拼接结果。这样长时间口述不会让活动路径无限增长，终稿仍然是一次提交。

### 3. 推理 Worker

主进程用常驻 `worker_threads` 承载 `sherpa-onnx-node`：懒启动、启动即加载模型、加载完成后才把 `startSession` 置为 `recording`。消息协议只包含 `start / audio / stop / cancel` 与 `ready / partial / final / error`。worker `error` 或非正常 `exit` → 当前会话转 `failed`，下次启动重新拉起；主进程不因推理异常退出。

`worker_threads` 只隔离事件循环，不隔离原生崩溃：模型变体不符或文件损坏时，原生 `abort()` 会带走整个 Electron 进程。因此清单校验是安全边界；文档化的恢复路径是"重启应用 + 重新安装模型"，而不是"捕获并继续"。

原生插件与 DLL 经 `asarUnpack` 随安装包发布；模型不进安装包。

### 4. 渲染层采音

`getUserMedia` 只请求音频，使用系统默认输入设备，开启回声消除/降噪/自动增益。`AudioContext` 以 16000Hz 构造；若实际 `sampleRate` 不等于 16000（设备/后端拒绝），进入明确的 `failed` 状态而不是带着错误采样率继续。AudioWorklet 以 100ms 为块把 Float32 转成 PCM16 `ArrayBuffer` 发给主进程。

渲染层独占采音与 UI；它不加载 WASM、不加载原生插件、不读模型文件。

静音检测在渲染层完成：连续 5 秒低于能量阈值即自动停止；录音开始后一直无语音也按同一规则停止，并走"未识别到语音"的结果。

### 5. 录音会话状态机（渲染层）

`idle → preparing → requesting-permission → recording → finalizing → idle`，任一阶段可进入 `failed`，`recording/finalizing` 可进入 `cancelled`。每个会话有唯一 id；所有主进程事件按 id 过滤，前一会话的迟到事件直接丢弃。

取消（Escape、按钮取消、切换会话、组件卸载）与停止是两个不同结果：取消丢弃转写并恢复快照，停止提交终稿。两者都必须释放麦克风与主进程会话。

### 6. Composer 绑定与写入

录音开始时对目标 ChatInput 做快照（编辑器 HTML、光标、是否聚焦），随后将 `contenteditable` 置为 false。Live Transcript 以纯文本形式显示在快照内容之后，不进入 chip、不触发斜杠命令、不写入草稿持久化。停止时把快照内容 + 终稿合并写入编辑器、恢复可编辑、光标置于末尾并聚焦；取消时原样恢复快照。

输入框在 `disabled`/`isSending` 等自身不可提交状态时，麦克风按钮不可启动录音；录音中出现这些状态变化按取消处理。

### 7. 入口、目标选择与快捷键

每个 ChatInput 渲染一个麦克风按钮（录音中变为停止，旁边提供取消）。点击时若模型不可用，先弹首次安装确认（尺寸与来源），确认后开始下载；下载完成自动进入录音，失败则保留可重试入口。

渲染层维护"已挂载 composer 注册表"，记录最近一次获得焦点的 composer。主进程注册全局 `Alt+V`：窗口隐藏或最小化时先显示并聚焦窗口，再向渲染层发 `onToggleRequest`；渲染层据此在最近聚焦的 composer 上开始/停止录音。没有可用目标时给出提示，不静默丢弃。

快捷键随应用退出注销。H5/移动端不注册、不渲染入口。

### 8. 设置

设置面板新增"语音输入"分区，展示：模型状态、已占用空间、安装/重新安装/移除、下载进度与取消、自定义下载地址。首次安装确认弹窗与分区使用同一安装入口，不出现两套下载逻辑。

### 9. 国际化与文案

所有用户可见文案（按钮 tooltip、确认弹窗、进度阶段、错误、空结果、权限指引）成对进入 zh-CN / en-US 对应域模块；英文文案不出现中文残留，反之亦然。

## Testing Decisions

**好测试的标准.** 只断言外部可观察行为：给定 PCM/事件序列，状态机产出什么状态与文本；给定 HTTP 响应与磁盘状态，模型管理器留下什么文件与状态；给定录音生命周期，编辑器里留下什么内容。不断言私有方法、内部字段或日志。

**已确认的测试缝（模块缝 + 纯函数）.**

1. `useVoiceInput` / 语音输入状态机：注入采音适配器、IPC 适配器、目标 composer 句柄。用它测状态迁移、事件过滤、5 秒静音自动停、取消/停止的差异、权限与设备错误映射。
2. 主进程语音会话服务：注入引擎工厂；测试用假引擎按脚本发 partial/final，覆盖单会话互斥、未知 id 忽略、停止收口、引擎失败转 `failed`、重新拉起。
3. 识别模型管理器：注入文件系统与 HTTP 客户端；用本地 HTTP 服务覆盖断点续传、服务端忽略 Range、哈希不符、取消、解包失败、原子就位、移除清理。
4. 纯函数：模型清单、路径规划、进度归一化、静音判定、快照合并规则。
5. ChatInput 组件：只测按钮可见性与禁用态、录音期间只读、终稿写入一次、取消恢复快照、卸载即取消；麦克风与 IPC 全部替身。

**不进 CI 的部分.** 真实 sherpa-onnx 推理与真实麦克风。前者用仓库外的冒烟脚本覆盖（加载、流式解码、RTF、打包后 DLL 加载，结果记录在 ADR 0014），后者由人工验收。

**先例.** 模型下载测试参考现有第三方二进制下载测试（本地替身驱动 HTTP/fs，断言"失败不留下半成品"）；ChatInput 测试参考现有提交面特征化测试与 contenteditable 的 jsdom 补丁方式；worker 会话参考现有 trace 解析 worker 的"worker 失败即回退/报错"客户端测试；store/composable 测试沿用 Pinia + 注入依赖的既有写法。

## Out of Scope

- 云端 STT、把音频或转写发送到任何第三方。
- H5、移动端、IM 桥接端的语音入口。
- 热词/自定义词表、说话人分离、语种手动切换、翻译。
- 麦克风设备选择器（仅系统默认设备）。
- 按住说话（push-to-talk）与全局键盘钩子。
- 语音指令（"发送"、"清空"）、自动发送、自动执行命令。
- 多个 Recording Session 并行，或同时向多个输入框写入。
- 模型选择 UI、模型自动升级、模型随安装包内置。
- 对已有音频文件做离线转写。
- 非 Windows x64 平台的发布验收（ADR 0014 的范围）。

## Further Notes

- 术语以 `CONTEXT.md` 为准：Voice Input、Recording Session、Live Transcript、Final Transcript、Speech Model。
- ADR 0014 已记录本机冒烟证据：Electron 43.6.0 + sherpa-onnx-node 2.0.0 流式解码 RTF 0.057–0.060、首个 partial 88–90ms、asar 打包后 DLL 正常加载。
- 本机实测 GitHub 直连约 47KB/s，127.7MB 约 45 分钟；因此断点续传与"慢但在动不算卡住"的停滞窗口是必需项，不是优化项。
- 镜像上的同族模型存在非流式导出（`comment=non-streaming zipformer2`），加载即原生崩溃。清单必须锁定 2026-06-05 的 streaming 资产与哈希。
- 解包依赖系统 `tar`（Windows 10+ 自带 bsdtar）；若目标机器缺失，安装应报可诊断错误，而不是静默失败。
- 首次安装后模型约 169MB；`.part` 文件最多再加一个压缩包大小。移除与取消都要清理这两类占用。
