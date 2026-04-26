## [0.2.0](https://github.com/hjdspace/claude-code-gui/compare/v0.1.1...v0.2.0) (2026-04-26)

### Features

* 添加任务列表卡片组件和推理深度控制功能 ([b6b60cb](https://github.com/hjdspace/claude-code-gui/commit/b6b60cbe0b2191135cdc3320b75c79b940a81284))
* **agent:** 添加多代理支持及任务管理功能 ([6db5b08](https://github.com/hjdspace/claude-code-gui/commit/6db5b0826435d4dc7360d87653c3ec989ddb2136))
* **chat:** 添加统一差异显示支持并优化文本选择 ([42aad61](https://github.com/hjdspace/claude-code-gui/commit/42aad610c27c3e91df8a728187939c3c3de46dc5))
* **chat:** 重构聊天输入组件，支持内联文件提及和上下文搜索 ([e01e41e](https://github.com/hjdspace/claude-code-gui/commit/e01e41e0a1bf31d06f293185723e353ced33eafa))

### Bug Fixes

* **chat:** 修复消息样式和错误处理问题 ([f32827f](https://github.com/hjdspace/claude-code-gui/commit/f32827f1dd69737da59f7942e95fe17043d99c8d))

## [0.1.1](https://github.com/hjdspace/claude-code-gui/compare/v0.1.0...v0.1.1) (2026-04-25)

### Features

* 添加 GitHub Actions 多平台打包工作流，支持 Win/Linux/Mac 自动构建和 Release ([4d8bf8e](https://github.com/hjdspace/claude-code-gui/commit/4d8bf8e98ecefefeeb9366d9aea0f7a2ac9e4a4a))

### Bug Fixes

* **打包:** 优化Bun下载逻辑并排除测试文件 ([751c4c4](https://github.com/hjdspace/claude-code-gui/commit/751c4c4634b53e0793e850a9d2f50e3b0dacfd93))
* 修复 bun 下载脚本路径冲突问题 ([4b0f8eb](https://github.com/hjdspace/claude-code-gui/commit/4b0f8eb950de9cd9bb14ef415f18295d07864aa2))

## [0.1.0](https://github.com/hjdspace/claude-code-gui/compare/317e86a50a4664d368206484f6b1fd9a2aa76dea...v0.1.0) (2026-04-24)

### Features

* **聊天输入:** 添加文件附件功能并增强输入框交互 ([e0b4757](https://github.com/hjdspace/claude-code-gui/commit/e0b47571c622cb2c8c1bf58d0b6b21df33e4a9eb))
* **命令系统:** 实现完整的斜杠命令功能 ([53dcf46](https://github.com/hjdspace/claude-code-gui/commit/53dcf460a50d3604bba39947ba88e3e579e8d9f5))
* **模型选择:** 添加可搜索的模型选择器并显示当前模型 ([76a004b](https://github.com/hjdspace/claude-code-gui/commit/76a004b4113a7c41f7f2c9422051317c039ad0a4))
* 添加文件夹选择对话框和快捷键功能 ([4fcddf4](https://github.com/hjdspace/claude-code-gui/commit/4fcddf4135154b58626e257885421e87220f04f5))
* 添加Claude Code IPC管理器和重构LLM服务 ([7366468](https://github.com/hjdspace/claude-code-gui/commit/736646845e340692743a3fe33beee3d1e59daa56))
* 新增技能管理功能及相关组件 ([5edcfc2](https://github.com/hjdspace/claude-code-gui/commit/5edcfc21aec51b90b82390983ed29deaa7d72626))
* **chat:** 添加停止功能并重构聊天输入组件 ([2facdab](https://github.com/hjdspace/claude-code-gui/commit/2facdab3711d339fef37846dfe8069028aec705d))
* **chat:** add MessageMetadata component ([db2c67f](https://github.com/hjdspace/claude-code-gui/commit/db2c67f3bb78966cf41c72c21aaa334f59e96e9b))
* **chat:** add ReasoningCard component for displaying thinking process ([37d71d3](https://github.com/hjdspace/claude-code-gui/commit/37d71d3a49458ee0478e79a0f24bbc421e3afc05))
* **chat:** add ToolCallCard component for displaying tool calls ([c11e2b7](https://github.com/hjdspace/claude-code-gui/commit/c11e2b777d087a22bcb9a1443d8ac3571dfa2aff))
* **chat:** add ToolCallList component ([0ae0367](https://github.com/hjdspace/claude-code-gui/commit/0ae03672b220b3ca554efe902051dcbe974486dd))
* **chat:** refactor MessageItem to integrate ReasoningCard, ToolCallList, and MessageMetadata ([424064b](https://github.com/hjdspace/claude-code-gui/commit/424064b8146a50b239adeb31ce850d085e877615))
* **chat:** update chat store to extract and store reasoning and tool call details ([9fede93](https://github.com/hjdspace/claude-code-gui/commit/9fede93989ebd46a2ce5728995c924c17ee6b6fc))
* **git:** 实现Git版本控制功能集成 ([97bacdb](https://github.com/hjdspace/claude-code-gui/commit/97bacdb13d900e26f4cb7d41c8ea81d5de849f17))
* **refactor:** 优化目录架构 ([a060b97](https://github.com/hjdspace/claude-code-gui/commit/a060b979329eab3a005fb0a936279bb9476a6df0))
* **terminal:** 改进CLI模型配置和终端启动机制 ([2c4a4b9](https://github.com/hjdspace/claude-code-gui/commit/2c4a4b9064d9e4e124586151aeabaea82e640b78))
* **terminal:** 支持多终端实例管理 ([0fd969d](https://github.com/hjdspace/claude-code-gui/commit/0fd969d4c548ee7651020f86954950b12b6a5ef9))
* **types:** extend Message type with reasoning, toolCalls, and metadata ([858ee4b](https://github.com/hjdspace/claude-code-gui/commit/858ee4b5dda85b36eab02de557b66b886534d9f2))

### Bug Fixes

* 允许在只有附件没有文本内容时发送消息 ([921271f](https://github.com/hjdspace/claude-code-gui/commit/921271fa47814e58d47a97f792a35861698aed0f))
* **chat:** fix type errors in MessageMetadata component ([f26dd10](https://github.com/hjdspace/claude-code-gui/commit/f26dd1008c9d0c4a13184b4af4ea317a787f4148))
* **gitService:** 修正分支名称匹配的正则表达式 ([e6bb9b6](https://github.com/hjdspace/claude-code-gui/commit/e6bb9b66791811eba00867ee7d87849586755d7a))
* **settings:** 优先使用已保存配置并防止空值覆盖 ([317e86a](https://github.com/hjdspace/claude-code-gui/commit/317e86a50a4664d368206484f6b1fd9a2aa76dea))
