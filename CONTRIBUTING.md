# 贡献指南

感谢你对 SpaceCode 的关注！欢迎各类贡献，包括但不限于功能开发、Bug 修复、文档改进、国际化翻译、技能与智能体扩展。

## 行为准则

参与本项目的每一位贡献者都需要遵守以下基本原则：

- **保持友善与尊重**：技术讨论对事不对人
- **欢迎新手**：不要假设他人的背景知识，耐心解答
- **聚焦内容**：评审代码而非评审作者
- **尊重不同观点**：技术选型允许分歧，最终以工程证据为准

任何形式的人身攻击、骚扰、歧视性言论都将被拒绝并关闭。

## 开发环境准备

```bash
# 1. Fork 仓库后克隆到本地
git clone https://github.com/<你的用户名>/SpaceCode.git
cd SpaceCode

# 2. 添加上游仓库
git remote add upstream https://github.com/hjdspace/SpaceCode.git

# 3. 安装 Desktop 依赖（会自动通过 postinstall 安装 engine 依赖）
npm install

# 4. 启动开发模式
npm run electron:dev
```

环境要求详见 [README.md#快速开始](./README.md#快速开始)。

## 开发流程

### 1. 创建分支

始终从最新的 `main` 创建特性分支：

```bash
git checkout main
git pull upstream main
git checkout -b feat/your-feature
# 或: fix/your-bugfix, docs/your-docs, refactor/your-refactor
```

### 2. 编码规范

- TypeScript 严格模式，禁止使用 `any`
- Vue SFC 使用 `<script setup lang="ts">` + scoped SCSS
- 组件文件名 PascalCase，composables 使用 `use` 前缀，stores 使用驼峰命名
- 路径别名 `@/` 映射到 `src/`
- 所有用户可见文案必须使用 vue-i18n `t()` 函数，不得硬编码中英文
- UI 元素必须使用主题 CSS 变量（`--bg-primary`、`--surface-hover` 等）

### 3. 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 中文规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**允许的 type：**

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改变外部行为） |
| `perf` | 性能优化 |
| `style` | 代码格式（不影响功能） |
| `docs` | 文档 |
| `test` | 测试相关 |
| `build` | 构建系统、依赖 |
| `ci` | CI 配置 |
| `chore` | 杂项 |

**示例：**

```
feat(profiles): 支持多模型配置切换与持久化

fix(chat): 修复会话切换时 turn checkpoint 残留问题

refactor(turn): 拆分 turn god object 为三个深模块
```

### 4. 测试

- 修改 Electron 主进程逻辑后运行：`npm run test:electron`
- 修改 Vue 组件或 composables 后运行：`npx vitest run`
- 修改构建相关后运行：`npm run build` 确保类型检查通过

### 5. 提交 PR

1. 推送到自己的 fork：`git push origin feat/your-feature`
2. 在 GitHub 上发起 Pull Request 到 `hjdspace/SpaceCode:main`
3. PR 标题遵循 Conventional Commits 规范
4. PR 描述中说明：
   - **变更内容**：做了什么
   - **变更原因**：为什么做
   - **测试方式**：如何验证
   - **关联 Issue**：Fixes #xxx（如有）

## 禁止事项

- ❌ 不要修改 `engine/` 目录下的代码（独立的 CLI 子项目，单独发版）
- ❌ 不要直接修改 `dist/`、`dist-electron/`、`release/` 等构建产物
- ❌ 不要提交 `.env` 等敏感文件
- ❌ 不要使用 `any` 类型
- ❌ 不要添加未请求的额外功能、抽象、配置项

## 国际化贡献

国际化文件位于 `src/i18n/locales/zh-CN.ts` 和 `src/i18n/locales/en-US.ts`：

- 新增 UI 文案时，**必须同时**在两个语言文件中添加对应键值
- 键名采用命名空间分组，如 `chat.sendMessage`、`settings.apiConfig`
- 不要硬编码任何用户可见的中文或英文字符串

## 技能与智能体贡献

- **技能（Skills）**：放置于 `skills-lib/<skill-name>/SKILL.md`，参考已有技能结构
- **智能体（Agents）**：放置于 `agents-lib/<agent-name>.md`，参考已有 agent 文件
- 技能与智能体可独立提交 PR，不影响桌面应用主流程

## 发版流程

项目使用 [github-release skill](./.trae/skills/github-release/SKILL.md) 自动化发版：

- 默认 patch +1（如 `0.6.6` → `0.6.7`）
- 主版本与次版本由维护者讨论决定
- 每次 release 自动生成 CHANGELOG 与 release-notes

## 问题与反馈

- **Bug 报告**：[GitHub Issues](https://github.com/hjdspace/SpaceCode/issues/new?template=bug_report.md)
- **功能建议**：[GitHub Issues](https://github.com/hjdspace/SpaceCode/issues/new?template=feature_request.md)
- **安全漏洞**：参见 [SECURITY.md](./SECURITY.md)
- **使用讨论**：[GitHub Discussions](https://github.com/hjdspace/SpaceCode/discussions)

## 许可证

贡献的代码将在 [MIT License](./LICENSE) 下发布。提交 PR 即表示你同意以相同许可证授权你的贡献。
