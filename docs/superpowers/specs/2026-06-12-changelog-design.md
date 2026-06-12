# 更新日志功能设计

## 概述

为 SpaceCode 桌面应用添加更新日志弹窗功能。用户安装新版本后首次打开应用时，自动弹出该版本的更新日志；关闭后可通过 TitleBar 版本号入口再次查看。

## 需求

1. 应用启动时检测版本变化，自动弹出更新日志
2. 更新日志内容来源：本地 `release-notes/` 优先，GitHub API 远程兜底
3. 仅展示当前版本的更新日志
4. 弹窗关闭后，更新 `lastViewedChangelogVersion`，不再自动弹出
5. 用户可通过点击 TitleBar 版本号 badge 再次查看
6. 支持 Markdown 渲染

## 数据流

```
应用启动 → App.vue onMounted
  → api.getAppVersion() 获取当前版本
  → 与 settings.lastViewedChangelogVersion 比较
  → 版本不同 → api.changelog.getReleaseNotes(version)
    → 主进程先读本地 release-notes/v{version}.md
    → 本地不存在 → 调用 GitHub API 获取
    → 返回内容 → 弹出 ChangelogModal
  → 弹窗关闭 → 更新 lastViewedChangelogVersion = currentVersion
```

## IPC 通道

| 通道 | 方向 | 参数 | 返回值 | 说明 |
|------|------|------|--------|------|
| `changelog:getReleaseNotes` | renderer→main | `version: string` | `{ content: string, source: 'local' \| 'remote' } \| null` | 读取指定版本的 release notes |

主进程 `changelog:getReleaseNotes` 逻辑：
1. 先尝试读取本地 `release-notes/v{version}.md`
   - `app.isPackaged` → `path.join(process.resourcesPath, 'release-notes', 'v{version}.md')`
   - 开发模式 → `path.join(__dirname, '../release-notes', 'v{version}.md')`
2. 本地文件不存在 → 调用 GitHub API `https://api.github.com/repos/hjdspace/SpaceCode/releases/tags/v{version}`，提取 `body` 字段
3. 都失败 → 返回 null

## 组件设计

### ChangelogModal.vue

- 位置：`src/components/common/ChangelogModal.vue`
- Teleport to body，v-model 控制显隐
- 标题：`SpaceCode v{version} 更新日志`
- 内容区：Markdown 渲染（使用项目已有的 `marked` 依赖）
- 底部：关闭按钮
- 样式复用现有 Modal 模式（`.modal-overlay` + `.modal-content`）

### 触发入口

1. **自动弹出**：App.vue onMounted 中检测版本变化
2. **手动查看**：点击 TitleBar 的版本号 badge 打开 ChangelogModal

## 持久化

`lastViewedChangelogVersion` 存入 settings store，随 `gui-settings.json` 持久化。首次安装时该字段不存在，也会触发弹窗。

## electron-builder 配置

`package.json` 的 `extraResources` 新增：
```json
{ "from": "release-notes", "to": "release-notes" }
```

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `electron/autoUpdaterService.ts` | 新增 `changelog:getReleaseNotes` handler |
| `electron/preload.ts` | 新增 `changelog` 命名空间 |
| `src/services/electronAPI.ts` | 新增 `changelog` API 封装 |
| `src/stores/settings.ts` | 新增 `lastViewedChangelogVersion` 字段 |
| `src/components/common/ChangelogModal.vue` | 新建：更新日志弹窗组件 |
| `src/App.vue` | 挂载 ChangelogModal + onMounted 检测逻辑 |
| `src/components/layout/TitleBar.vue` | 版本号 badge 点击打开 ChangelogModal |
| `package.json` | extraResources 新增 release-notes |

## 错误处理

- 本地文件读取失败：静默 fallback 到 GitHub API
- GitHub API 请求失败（网络/速率限制/私有仓库）：返回 null，不弹窗
- Markdown 渲染失败：显示原始文本
