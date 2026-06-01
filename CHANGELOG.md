## [0.4.4](https://github.com/hjdspace/SpaceCode/compare/v0.4.3...v0.4.4) (2026-06-01)

### Features

* **聊天图片预览:** 新增应用内图片灯箱预览功能
  - 替换原新窗口打开图片逻辑，支持点击图片在当前页面弹出灯箱预览
  - 支持点击关闭按钮或遮罩层关闭预览

### Refactor

* **设置页面重构:** 全面重构设置模块，统一组件样式与设计系统
  - 新增基础样式文件 `_settings-base.scss`，统一所有设置页面的组件样式规范
  - 重构设置面板布局，新增侧边导航栏并拆分菜单分组
  - 替换所有硬编码样式为 CSS 变量，统一使用项目设计系统
  - 补充密度相关的国际化多语言文案（zh-CN/en-US）
  - 优化 Token 用量、快捷键、工具等页面的 UI 结构和样式
  - 修复部分组件的阴影、边框和交互样式问题

### Style

* **全局样式:** 在全局样式中导入基础设置模块
* **UI 调整:** 调整多个面板宽度限制与消息渲染逻辑

---

## [0.4.3](https://github.com/hjdspace/SpaceCode/compare/v0.4.2...v0.4.3) (2026-06-01)

### Features

* **Caveman 压缩Skills:** 新增完整的压缩工具与插件生态
  - 初始化 caveman 项目，添加核心压缩模式、命令与代理服务
  - 支持 Claude Code、OpenCode 等多平台插件集成
  - 实现代码审查、提交信息生成等配套工具
  - 提供完整的文档、测试与安装脚本
  - 配置 CI/CD 与项目基础结构
* **文件式规划技能套件:** 新增 Manus 风格的文件式规划功能
  - 新增完整的基础配置文件和多 IDE 钩子支持
  - 支持多语言命令文档（阿拉伯语、德语、西班牙语、中文）
  - 兼容 Claude Code、Cursor、GitHub Copilot 等工具
  - 提供测试用例与 CI 流程支持
* **Hook 管理系统:** 新增自定义会话生命周期钩子功能
  - 新增 electronAPI 的 hooks 设置持久化方法
  - 添加 Hook 设置面板与编辑弹窗组件
  - 新增 hooks 相关类型定义与 Pinia 状态管理
  - 支持用户级/项目级/本地级三种作用域的 Hook 配置
  - 提供卡片/表格/时间线三种视图展示 Hook 列表
  - 多语言国际化支持 Hook 设置页面
  - 重构代理配置逻辑，改为由 Shadow Home 统一处理第三方提供商配置
* **UI 技能库扩展:** 新增多套前端 UI 设计技能包
  - 新增 10 套前端 UI 设计技能包（极简主义、工业粗野主义等风格）
  - 新增 stitch-design-taste 技能，支持生成谷歌 Stitch 专用设计规范文档
  - 新增 skills-lock.json 锁定技能版本与哈希校验
* **API 代理增强:** 完善 Anthropic 和 OpenAI 消息格式互转逻辑
  - 新增工具调用转换支持
  - 修复多内容块消息处理
  - 添加空值和类型校验
* **引擎数据流分析:** 新增 Claude-Code Engine 数据流分析文档

### Bug Fixes

* **引擎切换:** 解决 10 个 Claude Code CLI 引擎切换问题
  - **P0 修复：** 将 engineSource/installedCliPath 传递给 startSession（之前这些字段从未被转发，导致引擎源切换完全无效）
  - **P0 修复：** 修复代理自动启动条件，排除 claudeai/console 认证方式
  - **P1 优化：** 新增运行时引擎源切换时的动态代理启停功能
  - **P1 优化：** 替换硬编码代理端口 34567 为自动发现（范围 34567-34667）
  - **P1 优化：** 将 MAX_HEALTH_RETRIES 从 1 增加到 3，避免临时健康检查失败导致过早重启代理
  - **P2 优化：** 标记 claudeCodeProcessManager.ts 为 @deprecated（已被 sessionProcess.ts 取代）
  - **P2 优化：** 将代理注入中的静默 catch{} 替换为 warn 级别日志
  - **P2 优化：** 添加 CLI 版本兼容性检查（MIN_CLI_VERSION = 1.0.0）及版本过旧 UI 警告
  - **P2 优化：** 在引擎切换时保留 engineSessionId 并作为 resumeSessionId 传递以恢复对话上下文
  - **P2 优化：** 添加适配器状态定期刷新（10s 间隔）、停止时的 adapter-hint 文本及新 UI 元素的 i18n 字符串
* **URL 拼接:** 修复上游代理 URL 重复拼接版本路径的问题
  - 针对 OpenAI 兼容的上游代理配置，当基础 URL 已包含版本路径时避免重复拼接
  - 新增 URL 拼接工具函数统一处理 URL 拼接逻辑
* **Windows 兼容性:** 优化 Windows 平台 CLI 命令查找与执行逻辑
  - 新增对 Windows .cmd 脚本的优先匹配查找，避免找到非可执行的同名文件
  - 在启动会话进程时，自动为 .cmd 脚本启用 shell 执行模式
  - 修复 Windows 下非 .cmd 命令无法正常执行的问题
  - 新增 forceShell 参数强制启用 shell 执行

### Refactor

* **代理模式配置:** 优化代理模式下的模型配置逻辑
  - 更新代理服务器返回标准 Claude 模型列表
  - 代理模式下不传递 --model 参数，使用官网默认模型选择逻辑
  - 清空代理模式下的默认模型环境变量
  - 简化同步 settings.json 的代理模式逻辑，避免污染全局配置
* **代理启动流程:** 重构代理启动与 API 配置逻辑
  - 新增引擎源切换时自动启动代理的逻辑
  - 新增开机自动启动代理的逻辑
  - 重构 API 配置同步逻辑，适配代理模式下的配置清理与环境变量设置
* **CLI 检测:** 为 CliDetectionResult 接口新增 versionCompatible 字段

### Style

* **表单组件:** 优化表单样式与清理无用样式
  - 移除 HookSettings.vue 中无用的 .event-group 空样式
  - 将 HookEditModal 的复选框内联样式改为类名样式，并提取为 .accent-checkbox 类
  - 将 v-html 改为普通插值渲染提示文本，避免 XSS 风险

### Chore

* 清理无用的 ask-user-question-ui-demos.html 文件

---

## [0.4.2](https://github.com/hjdspace/SpaceCode/compare/v0.4.0...v0.4.2) (2026-05-30)

### Features

* **API 代理模块:** 实现 Anthropic ↔ OpenAI API 转换桥
  - 新增 HTTP 代理服务器，支持流式响应
  - 实现 Anthropic ↔ OpenAI 请求/响应转换器
  - 实现 OpenAI SSE 到 Anthropic SSE 的流式转换器
  - 新增模型映射和认证处理器
  - 实现 SSE 事件流解析器
  - 添加代理模块共享类型定义
  - 实现代理子进程入口点和生命周期管理（ProxyManager）
  - 增强流式转换器状态机逻辑
* **引擎源配置系统:** 支持可配置的 AI 引擎源
  - 新增 AI 引擎源设置 UI 组件（EngineSourceSettings）
  - 实现 CLI 检测器，支持环境检查和自动安装
  - 添加 IPC 处理程序和预加载 API 用于 CLI 检测和代理管理
  - 集成引擎源和代理到 SessionProcess
  - 将引擎源 UI 和代理生命周期集成到应用主流程
  - 设置页面支持恢复 engineSource 和 installedCliPath 字段
* **斜杠命令系统:** 实现完整斜杠命令功能
  - 实现完整的斜杠命令系统，对齐 TUI 功能
  - 添加斜杠命令支持和优化徽章处理
* **SCM 面板增强:** 提升版本控制面板交互体验
  - 为 SCM 面板添加可拖拽调整高度功能

### Bug Fixes

* **会话轮次:** 修复 turnCheckpointService 轮次错位问题
  - 过滤 tool_result 消息避免轮次计数错误
* **代理子进程:** 修复代理子进程无法启动的问题
  - 添加 tsx 运行时支持
  - 配置 esbuild 构建流程
* **Windows 兼容性:** 修复 Windows 平台 CLI 版本显示异常
  - 解决 .cmd 文件执行失败导致版本显示为 unknown 的问题

### Refactor

* **Electron 主进程:** 统一追加系统提示词的处理逻辑
* **聊天输入框:** 提取发送后清理逻辑为复用函数
* **命令面板:** 重构监听逻辑，替换手动调用为 watch 模式
* **API 配置:** 统一 SCM、聊天、设置模块的 API URL 规范化逻辑
  - 修复环境变量加载顺序问题
  - 添加连接测试功能
* **SCM 面板:** 调整提交区域与图表区域的 flex 占比

### Style

* **全局样式:** 更新全局样式变量，调整主题配色与中性色

### Documentation

* **设计文档:** 添加官网引擎切换 + API 转换桥实现计划
* **技术方案:** 添加官网 Claude Code 引擎切换 + API 转换桥设计文档

### Build

* **构建优化:** 移除废弃的 proxy 打包配置并优化相关代码

---

## [0.4.0](https://github.com/hjdspace/SpaceCode/compare/v0.3.10...v0.4.0) (2026-05-28)

### Features

* **编辑器集成:** 新增通过 VSCode/GVim 打开文件或项目的功能
  - 新增文件树节点根节点标记属性
  - 实现主进程编辑器调用逻辑，支持 VSCode 和 GVim
  - 添加右键菜单打开文件/项目到编辑器选项
  - 顶部标题栏新增快速打开文件到编辑器的下拉菜单
  - 补充中英文多语言配置项
* **命令系统:** 将 commit 命令暴露给用户并添加会话回合检查点加载
  - 将 commit 命令从 INTERNAL_ONLY_COMMANDS 移至 COMMANDS 列表
  - 在 BUILT_IN_COMMANDS 中注册 commit 命令为 agent_skill 类型
  - 在保存会话后加载 turn checkpoints 以支持会话恢复功能
* **Diff 视图:** 优化 diff 生成逻辑并调整 UI 间距
  - 重构 diff 计算逻辑，引入上下文行处理机制
  - 实现符合 Git diff 格式的 hunk 头部及行号标注
  - 调整 AgentTimeline 组件样式，优化 padding 间距与类名结构

### Bug Fixes

* **会话存储:** 修复会话存储路径匹配不一致问题
  - 调整 transcriptFileExists 方法匹配引擎的路径解析规则
  - 优先使用 CLAUDE_CONFIG_DIR 环境变量，不使用 XDG_CONFIG_HOME
  - 对工作目录做 realpath 解析，解决 Linux 桌面环境下会话文件检测失败导致的程序崩溃问题

### Refactor

* **设计系统:** 统一设计系统并修复 diff 渲染问题
  - 新增 surface 系列设计 token 并替换全局旧样式变量
  - 为 DiffView 和工具组件添加正确的 key 防止渲染异常
  - 优化时间线缓存和组件样式细节
* **聊天界面:** 调整回滚按钮位置与消息内容布局
  - 修复 diff 计算时获取首行编号的逻辑，改为查找有效条目而非直接取第一个元素
  - 将回滚按钮移入消息内容容器中，调整样式对齐与移动端适配
  - 重构消息内容区域的 DOM 结构与样式，统一管理消息内容与回滚按钮的布局
* **技能库:** 改进技能库路径查找逻辑并添加调试日志
  - 重构 getSkillsLibRoot 函数，添加 fallback 路径处理以适配不同打包/开发环境
  - 为技能库相关操作添加详细的调试和日志输出
  - 为 tryAsBundle 函数添加异常捕获，避免扫描流程崩溃
  - 移除 fs:searchFiles 的 IPC 调试日志

### Style

* **全局样式:** 更新全局样式变量为官方设计规范
  - 统一调整圆角尺寸、色彩系统、文本颜色与代码高亮配色
  - 同时优化暗黑模式下的配色与排版注释
* **主题系统:** 更新 Anthropic 明暗主题的官方配色与变量规范
  - 对 anthropic 和 anthropic-dark 主题的所有 CSS 变量进行标准化更新
  - 调整背景色、文字色、边框色等基础配色为官方规范值
  - 统一透明度参数与阴影效果参数
  - 优化代码块语法高亮配色
  - 修正 git diff 视图的配色适配
  - 添加模块化注释说明各系统变量分组
* **标题栏:** 优化标题栏样式与交互细节
  - 替换玻璃态背景为纯色主背景，移除底部渐变发光效果
  - 调整间距、字体样式与按钮交互状态
  - 为可交互元素添加焦点框样式，优化过渡动画
  - 为下拉菜单添加入场动画与样式优化

### Build

* **技能库:** 新增 superpowers 技能库及相关配置文件
  - 新增完整的 superpowers 技能库，包含 TDD、调试、协作等开发技能
  - 添加项目配置、文档、测试用例和多平台插件支持
  - 修复 .gitignore 路径问题

### Chore

* **electron:** 移除技能服务路径查找中的调试日志，简化开发环境下的路径返回逻辑
* **gitignore:** 移除 .gitignore 中对 superpowers 目录的忽略规则

### Documentation

* **README:** 补充新增的 /commit 命令文档说明，完善功能列表

---

## [0.3.10](https://github.com/hjdspace/SpaceCode/compare/v0.3.9...v0.3.10) (2026-05-25)

### Features

* **Token统计:** 新增token使用量统计与设置页面
  - 添加token使用量追踪功能
  - 新增token统计设置页面
* **上下文缓存:** 新增上下文缓存token统计与快速加载功能
  - 优化上下文用量获取逻辑
  - 调整超时设置以提升性能
* **超时配置:** 为HTTP请求和LLM调用添加超时配置支持
  - 支持自定义HTTP请求超时
  - 支持自定义LLM调用超时

### Bug Fixes

* **MarkdownRenderer:** 修复文件链接无法正确渲染的问题

### Refactor

* **App.vue:** 抽离窗口事件处理函数为单独方法，提升代码可维护性
* **MCP管理器:** 迁移MCP管理器到全屏面板并重构状态管理
* **analyzeContext:** 移除全局roughEstimatesOnlyMode，改用参数传递，优化代码结构
* **electron:** 统一处理skills-lib路径解析逻辑，提升跨平台兼容性

### Build

* **CI:** 优化多平台原生模块构建与glibc错误提示

---

## [0.3.9](https://github.com/hjdspace/SpaceCode/compare/v0.3.8...v0.3.9) (2026-05-25)

### Features

* **上下文管理:** 添加上下文用量可视化与管理功能
  - 新增设置项控制上下文芯片和警告条显示
  - 新增上下文用量模态详情面板
  - 新增侧边栏上下文用量芯片与警告提示条
  - 新增设置页上下文用量预览组件
  - 完善上下文token估算逻辑与存储状态优化
* **多智能体协作:** 新增多智能体团队协作功能
  - 新增团队上下文、智能体状态与消息类型定义
  - 实现智能体会话独立查看与切换功能
  - 新增团队状态栏与智能体会话头部组件
  - 优化任务通知消息展示样式
* **代码回滚:** 完整实现代码回滚功能
  - 实现代码回滚预览文件加载功能，支持通过消息ID或索引查找回合检查点
  - 新增代码回滚确认弹窗组件，展示待回滚文件列表
  - 修复ID不匹配问题，新增基于索引的回滚快照查找策略
  - 回滚后自动恢复用户输入到聊天框
  - 修复both模式下代码回滚失败仍执行对话回滚的问题
* **内置技能:** 新增内置技能支持
  - 新增内置技能分组，支持展示和只读展示内置技能
  - 添加技能翻译通用组合式函数，重构技能详情页翻译逻辑
  - 限制内置技能的编辑和删除操作
  - 更新多语言文案支持内置技能相关展示
* **UI/UX Pro Max:** 新增UI/UX Pro Max技能完整实现与CLI工具

### Refactor

* **项目结构:** 整理项目结构并添加多项新功能
  - 移除全局自定义元素编译配置
  - 添加rewind聊天命令与rewind类型导出
  - 优化技能网格与分类侧边栏样式
  - 添加代码检测与补全辅助脚本
  - 更新gitignore配置与项目依赖
* **提交信息生成:** 优化自动生成提交信息逻辑
  - 支持系统提示词和暂存区校验
  - 仅当存在暂存变更时才触发生成
  - 采用Conventional Commits规范并支持中文输出
  - 截断diff内容上限提升至16000字符
* **SCM模块:** 优化提交信息生成与侧边栏布局
  - 调整侧边栏最小/最大宽度与面板默认宽度
  - 为提交输入框添加自动高度适配功能
  - 实现提交信息生成的多语言适配
  - 新增获取暂存区diff的API接口
* **UI优化:** 移除推理卡片和时间线中的Brain图标
* **测试修复:** 新增错误处理器导入并修复测试类型声明

### Chore

* **electron:** 强制禁用归因头以提升第三方代理缓存命中率

---

## [0.3.8](https://github.com/hjdspace/SpaceCode/compare/v0.3.7...v0.3.8) (2026-05-23)

### Features

* **技能管理:** 重构技能管理模块，实现多语言与功能优化
* **技能库:** 新增本地技能库功能与反模式检测工具
* **技能库:** 添加本地技能库目录，添加 Anthropic 开源技能
* **文件操作:** 新增文件右键菜单与聊天文件添加功能
* **提示词优化:** 添加提示词优化状态 UI 和国际化翻译
* **权限模式:** 新增权限模式支持（settings + chat）

### Bug Fixes

* **AgentTimeline:** 修复流式更新时界面卡住的问题
* **MarkdownRenderer:** 修复流式渲染导致的进程崩溃问题
* **提及芯片:** 修复提及芯片粘贴复制的格式问题

### Refactor

* **国际化:** 替换所有硬编码文本为国际化翻译
* **消息列表:** 优化消息列表与提问工具组件
* **electron:** 添加项目路径的真实路径解析
* **electron:** 重写 node-pty 加载逻辑，修复错误排查误导问题
* **工具组件:** 优化工具组件加载与存储性能，更新样式变量

---

## [0.3.7](https://github.com/hjdspace/SpaceCode/compare/v0.3.6...v0.3.7) (2026-05-17)

### Features

* **轮次变更追踪:** 实现完整的轮次变更追踪功能（任务 1/10 - 10/10）
  - 新增 turn checkpoint 类型定义和 IPC 通信层（类型定义 + IPC handlers + preload API + electronAPI wrapper）
  - 新增轮次变更状态管理（turn checkpoint store + 工具函数）
  - 新增 CurrentTurnChangeCard 主组件和工作区差异展示组件（WorkspaceDiffSurface）
  - 集成到 MessageList，支持历史会话轮次变更卡片展示
  - 完整的 i18n 国际化支持（中文/英文）
* **重构:** 将设置面板移至主内容区并重构展示逻辑
* **信息面板:** 重构信息面板，添加多标签页支持
* **技能管理:** 将技能管理器改为内嵌式面板，优化交互体验
* **工具卡片:** 替换自研 diff 展示为 @git-diff-view 组件，提升差异展示效果
* **工具调用:** EditTool 支持基于 git 获取原始内容，提升编辑准确性
* **工具卡片:** 优化工具卡片展开逻辑与会话列表体验
* **会话列表:** 重写历史会话恢复逻辑，提升稳定性

### Refactor

* **聊天面板:** 重写历史会话恢复逻辑
* **会话列表:** 优化会话列表展示和交互体验

---
---

### Features

* **权限控制:** 实现完整的权限控制系统
  - 新增 4 种权限模式：自动批准、手动批准、始终拒绝、仅建议
  - 添加 PermissionModeSelector 权限模式选择器组件
  - 添加 PermissionRequestCard 权限请求卡片，支持动态渲染
  - 集成权限控制到 ChatInput 工具栏和 AgentTimeline
  - 完整的 i18n 国际化支持（中文/英文）
  - 优雅降级：无活动进程时支持本地状态回退
* **历史会话:** 实现历史会话管理和恢复功能
  - 添加历史会话列表展示和搜索/过滤功能
  - 在 ChatPanel 中添加历史会话按钮和模态框
  - 支持使用原始会话 ID 恢复历史会话
  - 重写会话历史管理器，对齐 Claude-Code 引擎源码
* **设置:** 增强 API 配置管理
  - 新增 API 配置同步到 settings.json 功能
  - 调整 .env 配置加载逻辑，改为回退优先级

### Bug Fixes

* **权限控制:** 修复权限模式下拉位置、样式和刷新状态同步问题
* **组件:** 替换 v-click-outside 为原生事件监听器，提升兼容性
* **文件浏览器:** 移除文件树节点展开时的多余事件发送
* **会话:** 修复模态透明度和缺失的 getFullSession IPC handler
* **路径处理:** 修复 sanitizePath 与引擎源码不一致的问题（使用 '-' 替代 '_'）
* **类型修复:** 解决 formatTime 函数的 TypeScript 类型错误
* **配置:** 修复配置值首尾空格问题

### Refactor

* **工具调用:** 重构工具调用流程，支持新版权限控制协议
* **代码结构:** 优化代码结构与依赖配置
* **侧边栏:** 移除旧的历史会话相关代码

### Build

* **electron:** 修复 Electron 原生模块编译和加载问题

### Chore

* 移除无用的 AskUserQuestionToolCard 说明文档
* 添加 webview 自定义元素配置

---

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
