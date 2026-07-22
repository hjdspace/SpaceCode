---
name: commit-message
description: 生成符合 Conventional Commits 规范的中文提交信息。当用户请求生成 commit message、提交信息时使用。
---

# 提交信息生成

## 规范

- 格式：`<type>(<scope>): <subject>`
- type 取值：feat / fix / docs / style / refactor / test / chore
- scope：可选，影响的模块名
- subject：简明描述，不超过 50 字符，不以句号结尾
- body：可选，详细说明变更原因与影响
- footer：可选，标注 BREAKING CHANGE 或关联 issue

## 步骤

1. 使用 `grep_files` 与 `read_file` 查看变更文件
2. 识别变更类型（新功能/修复/重构/文档/测试/构建）
3. 识别影响范围（哪些模块/文件）
4. 生成 1-3 个候选提交信息供用户选择
5. 若有 BREAKING CHANGE，在 footer 显式标注

## 示例

```
feat(skills): 新增技能系统支持 GitHub 安装

- 实现 4 个 SkillSource（bundled/user/github/desktop-sync）
- 重构 LocalAgentService 接入 AgentSession 架构
- 添加斜杠命令菜单与技能管理页
```
