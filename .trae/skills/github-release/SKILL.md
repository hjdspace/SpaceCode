---
name: github-release
description: 自动化 GitHub Release 发布流程。分析提交记录、生成 CHANGELOG、升级版本号、打 Tag 并推送触发发布。Use when 用户要求发版、release、打 tag、发布新版本、升级版本号。
---

# GitHub Release 自动发布

自动化从提交分析到 GitHub Release 的完整发布流程。

## 前置条件

- 项目根目录存在 `CHANGELOG.md` 和 `package.json`
- `release-notes/` 目录存在（用于存放各版本 release notes）
- Git 工作区干净（无未提交修改）
- 远端仓库已配置并可推送

## 发布工作流

严格按以下步骤执行，**步骤 4 必须暂停等待用户确认**。

### 步骤 0：确认版本号（可选）

若用户在发版请求中指定了目标版本号（如"发版 v1.0.0"、"发布版本 0.5.0"），则使用用户指定的版本号，跳过自动计算。若用户未指定，则按默认规则 patch +1。

### 步骤 1：分析提交记录

```bash
# 获取最新 tag
git tag --sort=-v:refname | Select-Object -First 1

# 获取从最新 tag 到 HEAD 的所有提交
git log <latest-tag>..HEAD --pretty=format:"%h %s"
```

将提交按 Conventional Commits 类型分类：
- `feat:` → Features
- `fix:` → Bug Fixes
- `refactor:` → Refactor
- `perf:` → Performance
- `docs:` → Documentation
- `build:` / `ci:` → Build
- `chore:` → Chore

### 步骤 2：更新 CHANGELOG.md

1. 读取当前 `CHANGELOG.md` 首行版本号（如 `0.4.9`）
2. 版本号默认 patch +1（如 `0.4.9` → `0.4.10`，而非 `0.5.0`）
3. 若用户在步骤 1 之前声明了目标版本号，则使用用户指定的版本号
4. 在 CHANGELOG.md 顶部插入新版本条目，格式：

```markdown
## [x.y.z](https://github.com/<owner>/<repo>/compare/v<previous>...v<x.y.z>) (YYYY-MM-DD)

### Features

* **scope:** 描述

### Bug Fixes

* **scope:** 描述

### Refactor

* **scope:** 描述
```

> 日期使用当天日期，compare URL 从 package.json 的 homepage 字段提取仓库地址。

### 步骤 3：更新 package.json 版本号

将 `package.json` 中的 `version` 字段更新为新版本号。

### 步骤 3.5：生成 release-notes

在 `release-notes/` 目录下创建 `v<x.y.z>.md` 文件，内容基于步骤 1 的提交分析生成。

**格式规范**：

```markdown
## SpaceCode v<x.y.z>

一句话概述本版本最重要变更。

## Highlights

- **功能名称**：简要描述
- **功能名称**：简要描述

## Fixes

- 修复描述
- 修复描述

## Refactor

- 重构描述

**Full Changelog**: https://github.com/<owner>/<repo>/compare/v<previous>...v<x.y.z>
```

**生成规则**：

1. 第一段用 1-2 句话总结本版本核心变更
2. `Highlights` 放 feat 类提交，每个功能一条，用加粗功能名 + 冒号 + 描述
3. `Fixes` 放 fix 类提交
4. `Refactor` 放 refactor 类提交
5. 其他类型（docs、chore、style、ci、build）一般不写入 release notes，除非对用户有直接影响
6. 合并同类提交（如多个 cron 相关 feat 合并为一条）
7. 末尾附 Full Changelog 链接
8. 使用中文撰写

### 步骤 4：提交并暂停确认

```bash
git add CHANGELOG.md package.json release-notes/v<x.y.z>.md
git commit -m "chore(release): v<x.y.z>"
```

**⚠️ 必须在此暂停！** 向用户展示：
- 新版本号
- CHANGELOG 内容摘要
- release-notes 内容摘要
- commit 信息

使用 AskUserQuestion 询问用户是否确认继续，提供以下选项：
1. **确认发布** — 按当前版本号继续
2. **修改版本号** — 用户提供新版本号后重新生成 CHANGELOG 和 release-notes
3. **取消** — `git reset HEAD~1` 撤销提交

### 步骤 5：推送到远端

```bash
git push origin main
```

### 步骤 6：打 Tag 并推送

```bash
git tag v<x.y.z>
git push origin v<x.y.z>
```

Tag 推送后 GitHub Actions 自动触发发布流程。

## 异常处理

| 场景 | 处理方式 |
|------|---------|
| 工作区有未提交修改 | 提醒用户先提交或暂存 |
| 无历史 tag | 使用 `git log --pretty=format:"%h %s"` 获取所有提交 |
| push 失败 | 提示用户检查远端权限和网络 |
| 用户在步骤 4 拒绝 | `git reset HEAD~1` 撤销，恢复 CHANGELOG.md 和 package.json |

## 版本号规则

- 默认 patch +1（0.4.9 → 0.4.10，0.0.9 → 0.0.10）
- 用户可在发版请求中声明目标版本号（如"发版 v1.0.0"或"发布版本 0.5.0"），此时使用用户指定的版本号
- 用户也可在步骤 4 确认环节修改版本号
