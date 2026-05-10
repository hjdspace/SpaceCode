## [0.3.5](https://github.com/hjdspace/SpaceCode/compare/v0.3.4...v0.3.5) (2026-05-10)

### Features

* **pi-engine:** 新增教学流程学习笔记生成功能
  - 每个主题自动生成面向学习者的快速参考笔记
  - 优化会话状态管理和提示词长度约束
* **聊天面板:** 实现文件提及标记的富文本渲染
* **markdown:** 添加 Markdown 查看器组件并支持预览/源码模式切换
* **linux:** 为 Linux 系统添加自定义窗口控制功能
* **prompt-optimizer:** 支持根据项目上下文优化提示词
* **进程管理:** 改进引擎切换时的进程清理逻辑
* **engine:** 实现 PiEngine 进程池管理及会话处理优化

### Bug Fixes

* **file-edit:** 修复文件编辑/写入流程在缺少前置读取状态时的阻塞问题
* **thinking:** 保留模型响应中的推理/思考内容，避免丢失
* **thinking:** 移除自动"清除思考"的锁存行为

### Refactor

* **session:** 简化会话状态和提示词长度约束

### Documentation

* 添加详细的笔记生成指南和写作规则

### Tests

* 更新测试以反映保留推理行为和扩展的模型检测

## [0.3.4](https://github.com/hjdspace/SpaceCode/compare/v0.3.3...v0.3.4) (2026-05-10)

### Features

* **pi-engine:** 重构 PiEngine 实现进程池和多会话支持
  - 新增 PiProcessPool 进程池管理器，支持多会话并发
  - 新增 PiSessionProcess 会话进程管理，实现会话生命周期管理
  - 重构 PiEngine 核心逻辑，支持多模型提供商（OpenAI、Anthropic、Google、DeepSeek 等）
  - 添加 appendSystemPrompt 配置支持
  - 优化环境变量注入和命令行参数构建

### Bug Fixes

* **prompt-optimizer:** 修复模块导入问题，使用 createRequire 替代 ESM 动态导入
* **engine:** 修复桌面构建时 ripgrep 二进制文件未复制的问题
* **preload:** 修正 onExit 回调类型定义，支持更详细的退出信息

### Chore

* 更新依赖包（package-lock.json）

## [0.3.3](https://github.com/hjdspace/SpaceCode/compare/v0.3.2...v0.3.3) (2026-05-06)

### Features

* **图标:** 改进图标生成和加载逻辑 ([6dc41da](https://github.com/hjdspace/SpaceCode/commit/6dc41da))
  - 使用 png-to-ico 替代 sharp 生成兼容性更好的 .ico 文件
  - 添加图标生成脚本作为 electron 构建前置步骤
  - 改进图标加载逻辑，支持 .ico 和 .png 回退机制
  - 优化构建配置中的图标路径处理

### Styles

* **FileTree:** 调整背景样式为透明和毛玻璃效果 ([6314c54](https://github.com/hjdspace/SpaceCode/commit/6314c54))

## [0.3.2](https://github.com/hjdspace/SpaceCode/compare/v0.3.1...v0.3.2) (2026-05-06)

### Features

* **pi-engine:** 实现 Pi Engine 多引擎架构支持 ([776e8d5](https://github.com/hjdspace/SpaceCode/commit/776e8d5))
  - 添加 IEngine 接口和统一事件类型定义 ([776e8d5](https://github.com/hjdspace/SpaceCode/commit/776e8d5))
  - 添加 ClaudeCodeEngine 适配器 ([2c23de7](https://github.com/hjdspace/SpaceCode/commit/2c23de7))
  - 添加 EngineFactory 和 PiEngine 占位 ([e3e4f68](https://github.com/hjdspace/SpaceCode/commit/e3e4f68))
  - 通过 EngineFactory 路由 IPC 调用 ([a0d904b](https://github.com/hjdspace/SpaceCode/commit/a0d904b))
  - 添加 PiEventMapper 事件映射器 ([9fb275b](https://github.com/hjdspace/SpaceCode/commit/9fb275b))
  - 实现 PiEngine 核心功能 ([37e9e35](https://github.com/hjdspace/SpaceCode/commit/37e9e35))
  - 更新 settings.ts 支持引擎选择 ([4f8a960](https://github.com/hjdspace/SpaceCode/commit/4f8a960))
  - 更新 preload.ts 支持多引擎 ([e62d68c](https://github.com/hjdspace/SpaceCode/commit/e62d68c))
  - 更新设置 UI 和 chat store 支持引擎选择 ([511eb88](https://github.com/hjdspace/SpaceCode/commit/511eb88))
  - 添加 SDK 可用性检查和优雅降级 ([4e370cc](https://github.com/hjdspace/SpaceCode/commit/4e370cc))
* **chat:** 实现思考模式功能 ([7ebff5e](https://github.com/hjdspace/SpaceCode/commit/7ebff5e))
  - 实现消息流中思考和文本内容的增量处理 ([7ebff5e](https://github.com/hjdspace/SpaceCode/commit/7ebff5e))
  - 添加思考模式切换功能 ([d70a40f](https://github.com/hjdspace/SpaceCode/commit/d70a40f))
  - 改进思考模式交互和样式 ([2d9570b](https://github.com/hjdspace/SpaceCode/commit/2d9570b))
* **settings:** 实现外观设置的状态管理并优化 PiEngine 模型处理 ([3dce5de](https://github.com/hjdspace/SpaceCode/commit/3dce5de))

### Bug Fixes

* **pi-engine:** 当 Pi SDK 不可用时回退到 claude-code ([015858e](https://github.com/hjdspace/SpaceCode/commit/015858e))
* **pi-engine:** 使用 ESM 动态导入加载 pi SDK，添加为本地依赖 ([4ae6883](https://github.com/hjdspace/SpaceCode/commit/4ae6883))

### Chore

* 将 pi-engine 添加到 gitignore ([3e8514a](https://github.com/hjdspace/SpaceCode/commit/3e8514a))

## [0.3.1](https://github.com/hjdspace/SpaceCode/compare/v0.3.0...v0.3.1) (2026-05-06)

### Features

* **error-handling:** 添加完整的错误处理体系 ([a5539fe](https://github.com/hjdspace/SpaceCode/commit/a5539fe))
  - 集中化错误处理服务 ErrorHandler ([1149d9c](https://github.com/hjdspace/SpaceCode/commit/1149d9c))
  - 错误类型定义和国际化翻译（zh-CN/en-US）([7f66699](https://github.com/hjdspace/SpaceCode/commit/7f66699))
  - ErrorCard 内联错误组件 ([c8f2308](https://github.com/hjdspace/SpaceCode/commit/c8f2308))
  - ToastNotification 通知组件 ([225db22](https://github.com/hjdspace/SpaceCode/commit/225db22))
  - 集成到 chat store 支持超时检测 ([2646ba5](https://github.com/hjdspace/SpaceCode/commit/2646ba5))
  - 集成到 LLM 服务层 ([996d6c9](https://github.com/hjdspace/SpaceCode/commit/996d6c9))
  - 在 AgentTimeline 中渲染错误卡片 ([f0ce6fb](https://github.com/hjdspace/SpaceCode/commit/f0ce6fb))
  - 在 ChatPanel 中挂载通知组件 ([014d523](https://github.com/hjdspace/SpaceCode/commit/014d523))
* **webview:** 添加网页预览功能及相关导航控制 ([bd281d6](https://github.com/hjdspace/SpaceCode/commit/bd281d6))
* **主题:** 新增 Anthropic 主题和暗色主题 ([3e58bc5](https://github.com/hjdspace/SpaceCode/commit/3e58bc5))
* **debug:** 添加调试追踪功能 ([23736c3](https://github.com/hjdspace/SpaceCode/commit/23736c3))
* **engine:** 添加桌面版构建任务并增强会话进程可靠性 ([69a343a](https://github.com/hjdspace/SpaceCode/commit/69a343a))

### Bug Fixes

* **InfoPanel:** 添加 URL 验证并处理无效 URL 情况 ([f1cec94](https://github.com/hjdspace/SpaceCode/commit/f1cec94))
* **聊天:** 修复 ToastNotification 在终端模式下的显示问题，移至聊天内容区域内 ([f365bd5](https://github.com/hjdspace/SpaceCode/commit/f365bd5))
* **聊天:** 修复消息流加载状态显示问题 ([50c94c2](https://github.com/hjdspace/SpaceCode/commit/50c94c2))
* **会话管理:** 同步项目根目录到设置并保存 ([5b8b804](https://github.com/hjdspace/SpaceCode/commit/5b8b804))

### Refactor

* **InfoPanel:** 优化导航 URL 处理逻辑 ([0fb9391](https://github.com/hjdspace/SpaceCode/commit/0fb9391))
* 将项目名称从 claude-code-gui 统一更改为 SpaceCode ([0c8114a](https://github.com/hjdspace/SpaceCode/commit/0c8114a))

### Documentation

* 添加 LLM Agent 错误处理设计规格 ([550d7b0](https://github.com/hjdspace/SpaceCode/commit/550d7b0))
* 添加 LLM 错误处理实现计划 ([143f0b9](https://github.com/hjdspace/SpaceCode/commit/143f0b9))

## [0.3.0](https://github.com/hjdspace/SpaceCode/compare/v0.2.5...v0.3.0) (2026-05-05)

### Features

* **terminal:** 添加内嵌终端功能支持交互式命令执行 ([32ccd42](https://github.com/hjdspace/SpaceCode/commit/32ccd42))
  - 重构终端模块，支持多标签页管理 ([092fba0](https://github.com/hjdspace/SpaceCode/commit/092fba0))
  - 缓存调试日志路径以避免重复计算 ([7fc71f7](https://github.com/hjdspace/SpaceCode/commit/7fc71f7))
* **工具卡片:** 添加在面板中查看功能并实现工具差异查看器 ([0375864](https://github.com/hjdspace/SpaceCode/commit/0375864))
  - 为工具卡片添加语法高亮和统一diff视图 ([191044d](https://github.com/hjdspace/SpaceCode/commit/191044d))
  - 添加显示文件内容的API ([745effd](https://github.com/hjdspace/SpaceCode/commit/745effd))
  - 增加工具调用状态显示和警告提示 ([bf29d3c](https://github.com/hjdspace/SpaceCode/commit/bf29d3c))
* **chat:** 添加消息时间线功能并优化工具卡片状态显示 ([9651f8f](https://github.com/hjdspace/SpaceCode/commit/9651f8f))
* **项目工作流:** 实现统一的项目打开流程和最近项目记录 ([ffa27c5](https://github.com/hjdspace/SpaceCode/commit/ffa27c5))

### Bug Fixes

* **chat:** 修复项目关闭时会话清理不彻底的问题 ([d03e1b9](https://github.com/hjdspace/SpaceCode/commit/d03e1b9))
* **组件:** 修复工具卡片和差异查看器的条件渲染问题 ([dbee942](https://github.com/hjdspace/SpaceCode/commit/dbee942))

### Refactor

* **chat:** 将timelineToolCallIds移到循环外部以避免重复创建 ([ec7b4b3](https://github.com/hjdspace/SpaceCode/commit/ec7b4b3))
* **AgentTimeline:** 优化时间线事件处理逻辑并重命名代理名称 ([8573654](https://github.com/hjdspace/SpaceCode/commit/8573654))
* **llm:** 移除buildApiUrl函数中的调试日志 ([2406743](https://github.com/hjdspace/SpaceCode/commit/2406743))

## [0.2.5](https://github.com/hjdspace/SpaceCode/compare/v0.2.4...v0.2.5) (2026-05-03)

### Features

* **i18n:** 添加国际化支持并集成到所有组件 ([be8e496](https://github.com/hjdspace/SpaceCode/commit/be8e496))
  - 实现多语言支持，包含英语和简体中文翻译
  - 添加 vue-i18n 依赖并配置基础设置
  - 修改所有组件使用翻译文本替代硬编码字符串
  - 添加 GUI 设置持久化功能防止本地存储丢失

### Bug Fixes

* **settings:** 改进设置存储序列化和终端进程终止方式 ([502e795](https://github.com/hjdspace/SpaceCode/commit/502e795))
  - 将设置存储的JSON序列化添加格式化参数，提高可读性
  - 修改Unix/Linux/macOS终端进程终止方式为SIGKILL，确保强制终止
* **terminal:** 改进 Windows 平台进程终止方式确保彻底清理

### Build

* **installer:** 添加NSIS安装脚本并更新.gitignore ([9ae50db](https://github.com/hjdspace/SpaceCode/commit/9ae50db))
  - 添加Windows Defender排除项的NSIS安装脚本，提升首次启动速度
  - 从.gitignore中移除build/目录，因现在需要跟踪build目录下的安装脚本

## [0.2.2](https://github.com/hjdspace/SpaceCode/compare/v0.2.1...v0.2.2) (2026-05-02)

### Features

* **build:** 完善 GitHub Actions 构建配置，添加 bun_target 矩阵变量 ([build-release.yml](https://github.com/hjdspace/SpaceCode/commit/build-release))
* **build:** 添加 build-time secrets 注入支持 GitHub OAuth 功能
* **build:** 添加 sync-updates job 自动同步 release 到成都更新服务器

### Bug Fixes

* **sessionProcess:** 修复 JSON 解析错误处理缺失异常信息的问题 ([sessionProcess.ts](https://github.com/hjdspace/SpaceCode/commit/sessionProcess))
* **claudeCodeProcessPool:** 修复会话恢复时事件监听器重复注册导致的内存泄漏风险

### Refactor

* **claudeCodeProcessPool:** 重构事件监听器管理机制，使用命名引用精确管理
* **claudeCodeProcessManager:** 简化 resolveBunPath 逻辑，三级回退更可靠

## [0.2.1](https://github.com/hjdspace/SpaceCode/compare/v0.2.0...v0.2.1) (2026-04-28)

### Features

* **icons:** 添加应用图标及生成脚本 ([1f75d45](https://github.com/hjdspace/SpaceCode/commit/1f75d45))
* **chat:** 添加点击输入框自动聚焦功能 ([5235696](https://github.com/hjdspace/SpaceCode/commit/5235696))
* **工具卡片:** 添加多种工具卡片组件及工具注册系统 ([4b3cf7e](https://github.com/hjdspace/SpaceCode/commit/4b3cf7e))

### Bug Fixes

* 移除对内置代理的系统提示限制 ([a03951f](https://github.com/hjdspace/SpaceCode/commit/a03951f))

### Refactor

* 移除调试日志和未使用的取消功能 ([3a0bde3](https://github.com/hjdspace/SpaceCode/commit/3a0bde3))

### Build

* 更新 build-release.yml 构建配置 ([fef3345](https://github.com/hjdspace/SpaceCode/commit/fef3345))
* 将 node-pty 添加到打包文件和 asarUnpack 配置中 ([bbfc7db](https://github.com/hjdspace/SpaceCode/commit/bbfc7db))

## [0.2.0](https://github.com/hjdspace/SpaceCode/compare/v0.1.1...v0.2.0) (2026-04-26)

### Features

* 添加任务列表卡片组件和推理深度控制功能 ([b6b60cb](https://github.com/hjdspace/SpaceCode/commit/b6b60cbe0b2191135cdc3320b75c79b940a81284))
* **agent:** 添加多代理支持及任务管理功能 ([6db5b08](https://github.com/hjdspace/SpaceCode/commit/6db5b0826435d4dc7360d87653c3ec989ddb2136))
* **chat:** 添加统一差异显示支持并优化文本选择 ([42aad61](https://github.com/hjdspace/SpaceCode/commit/42aad610c27c3e91df8a728187939c3c3de46dc5))
* **chat:** 重构聊天输入组件，支持内联文件提及和上下文搜索 ([e01e41e](https://github.com/hjdspace/SpaceCode/commit/e01e41e0a1bf31d06f293185723e353ced33eafa))

### Bug Fixes

* **chat:** 修复消息样式和错误处理问题 ([f32827f](https://github.com/hjdspace/SpaceCode/commit/f32827f1dd69737da59f7942e95fe17043d99c8d))

## [0.1.1](https://github.com/hjdspace/SpaceCode/compare/v0.1.0...v0.1.1) (2026-04-25)

### Features

* 添加 GitHub Actions 多平台打包工作流，支持 Win/Linux/Mac 自动构建和 Release ([4d8bf8e](https://github.com/hjdspace/SpaceCode/commit/4d8bf8e98ecefefeeb9366d9aea0f7a2ac9e4a4a))

### Bug Fixes

* **打包:** 优化Bun下载逻辑并排除测试文件 ([751c4c4](https://github.com/hjdspace/SpaceCode/commit/751c4c4634b53e0793e850a9d2f50e3b0dacfd93))
* 修复 bun 下载脚本路径冲突问题 ([4b0f8eb](https://github.com/hjdspace/SpaceCode/commit/4b0f8eb950de9cd9bb14ef415f18295d07864aa2))

## [0.1.0](https://github.com/hjdspace/SpaceCode/compare/317e86a50a4664d368206484f6b1fd9a2aa76dea...v0.1.0) (2026-04-24)

### Features

* **聊天输入:** 添加文件附件功能并增强输入框交互 ([e0b4757](https://github.com/hjdspace/SpaceCode/commit/e0b47571c622cb2c8c1bf58d0b6b21df33e4a9eb))
* **命令系统:** 实现完整的斜杠命令功能 ([53dcf46](https://github.com/hjdspace/SpaceCode/commit/53dcf460a50d3604bba39947ba88e3e579e8d9f5))
* **模型选择:** 添加可搜索的模型选择器并显示当前模型 ([76a004b](https://github.com/hjdspace/SpaceCode/commit/76a004b4113a7c41f7f2c9422051317c039ad0a4))
* 添加文件夹选择对话框和快捷键功能 ([4fcddf4](https://github.com/hjdspace/SpaceCode/commit/4fcddf4135154b58626e257885421e87220f04f5))
* 添加Claude Code IPC管理器和重构LLM服务 ([7366468](https://github.com/hjdspace/SpaceCode/commit/736646845e340692743a3fe33beee3d1e59daa56))
* 新增技能管理功能及相关组件 ([5edcfc2](https://github.com/hjdspace/SpaceCode/commit/5edcfc21aec51b90b82390983ed29deaa7d72626))
* **chat:** 添加停止功能并重构聊天输入组件 ([2facdab](https://github.com/hjdspace/SpaceCode/commit/2facdab3711d339fef37846dfe8069028aec705d))
* **chat:** add MessageMetadata component ([db2c67f](https://github.com/hjdspace/SpaceCode/commit/db2c67f3bb78966cf41c72c21aaa334f59e96e9b))
* **chat:** add ReasoningCard component for displaying thinking process ([37d71d3](https://github.com/hjdspace/SpaceCode/commit/37d71d3a49458ee0478e79a0f24bbc421e3afc05))
* **chat:** add ToolCallCard component for displaying tool calls ([c11e2b7](https://github.com/hjdspace/SpaceCode/commit/c11e2b777d087a22bcb9a1443d8ac3571dfa2aff))
* **chat:** add ToolCallList component ([0ae0367](https://github.com/hjdspace/SpaceCode/commit/0ae03672b220b3ca554efe902051dcbe974486dd))
* **chat:** refactor MessageItem to integrate ReasoningCard, ToolCallList, and MessageMetadata ([424064b](https://github.com/hjdspace/SpaceCode/commit/424064b8146a50b239adeb31ce850d085e877615))
* **chat:** update chat store to extract and store reasoning and tool call details ([9fede93](https://github.com/hjdspace/SpaceCode/commit/9fede93989ebd46a2ce5728995c924c17ee6b6fc))
* **git:** 实现Git版本控制功能集成 ([97bacdb](https://github.com/hjdspace/SpaceCode/commit/97bacdb13d900e26f4cb7d41c8ea81d5de849f17))
* **refactor:** 优化目录架构 ([a060b97](https://github.com/hjdspace/SpaceCode/commit/a060b979329eab3a005fb0a936279bb9476a6df0))
* **terminal:** 改进CLI模型配置和终端启动机制 ([2c4a4b9](https://github.com/hjdspace/SpaceCode/commit/2c4a4b9064d9e4e124586151aeabaea82e640b78))
* **terminal:** 支持多终端实例管理 ([0fd969d](https://github.com/hjdspace/SpaceCode/commit/0fd969d4c548ee7651020f86954950b12b6a5ef9))
* **types:** extend Message type with reasoning, toolCalls, and metadata ([858ee4b](https://github.com/hjdspace/SpaceCode/commit/858ee4b5dda85b36eab02de557b66b886534d9f2))

### Bug Fixes

* 允许在只有附件没有文本内容时发送消息 ([921271f](https://github.com/hjdspace/SpaceCode/commit/921271fa47814e58d47a97f792a35861698aed0f))
* **chat:** fix type errors in MessageMetadata component ([f26dd10](https://github.com/hjdspace/SpaceCode/commit/f26dd1008c9d0c4a13184b4af4ea317a787f4148))
* **gitService:** 修正分支名称匹配的正则表达式 ([e6bb9b6](https://github.com/hjdspace/SpaceCode/commit/e6bb9b66791811eba00867ee7d87849586755d7a))
* **settings:** 优先使用已保存配置并防止空值覆盖 ([317e86a](https://github.com/hjdspace/SpaceCode/commit/317e86a50a4664d368206484f6b1fd9a2aa76dea))
