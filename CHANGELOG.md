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
