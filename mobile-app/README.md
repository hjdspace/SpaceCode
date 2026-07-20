# SpaceCode Mobile

SpaceCode 移动客户端，基于 Flutter 构建。提供本地 AI Agent、GitHub 仓库管理、桌面端协同等能力，支持在手机上完成编码任务。

当前版本：**v0.2.0**

## 功能

### 本地 AI Agent

- OpenAI 兼容的 `/chat/completions` 接口，支持任意兼容服务（OpenAI、DeepSeek、Moonshot、Together、OpenRouter 等）
- **流式输出**：LLM 回复实时逐 token 显示
- **工具调用**：自动调用 `list_files` / `read_file` / `write_file` 完成代码读写，最多 8 轮循环
- **模型选择**：从 API 拉取模型列表（OpenAI `/models` 接口），支持下拉选择或手动输入
- 配置持久化：API Key / Base URL / Model 保存到本地，重启后自动加载

### GitHub 集成

- **Device Flow 认证**：通过浏览器登录 GitHub 完成授权，无需在 App 内输入密码
- **仓库管理**：浏览授权账号下的仓库列表、选择分支
- **自动 clone**：选择仓库后自动 clone 到手机本地工作目录
- **自动 PR**：Agent 修改文件后自动 commit 并创建 Pull Request
- **实时反馈**：clone 仓库和创建 PR 都以 ToolCallCard 形式显示进度

### 桌面端协同

通过扫码连接 SpaceCode 桌面端，把手机作为远程输入设备。

## 快速开始

### 环境要求

- Flutter 3.22+
- Dart 3.4+
- Android SDK 36+（AGP 9 兼容）

### 本地运行

```bash
cd mobile-app
flutter pub get
flutter run --dart-define=SPACE_CODE_GITHUB_CLIENT_ID=your_client_id
```

### 构建 Debug APK

```bash
flutter build apk --debug \
  --dart-define=SPACE_CODE_GITHUB_CLIENT_ID=your_client_id
```

产物路径：`build/app/outputs/flutter-apk/app-debug.apk`

### 构建 Release APK

```bash
flutter build apk --release \
  --dart-define=SPACE_CODE_GITHUB_CLIENT_ID=your_client_id
```

产物路径：`build/app/outputs/flutter-apk/app-release.apk`

## GitHub OAuth 配置

本地 Agent 的 GitHub 集成使用 Device Flow，需要在 GitHub 注册 OAuth App：

1. 浏览器打开 https://github.com/settings/developers
2. `New OAuth App`
   - Application name：`SpaceCode Mobile`（随意）
   - Homepage URL：任意（如 `https://github.com/your-username`）
   - Authorization callback URL：`http://localhost`（Device Flow 用不到，但必填）
3. 创建后页面会显示 **Client ID**（公开标识符，可硬编码到 App）
4. 通过 `--dart-define=SPACE_CODE_GITHUB_CLIENT_ID=xxx` 注入

> Client ID 是公开标识符，可以硬编码到 App 里，不算敏感信息。
> Client Secret 才是密钥（Device Flow 不需要）。

## 使用流程

### 本地 Agent 模式

1. 打开 App → 设置 → 配置 API Key / Base URL / Model（点模型右侧刷新按钮可拉取列表）
2. 返回聊天页 → 工作栏选择「本地」模式 → 选择工作目录
3. 输入问题，Agent 会自动调用工具读写文件

### GitHub 仓库模式

1. 设置 → 点「连接 Github」→ 浏览器完成 Device Flow 认证
2. 返回聊天页 → 工作栏第一个 chip 切换到「云端」→ 选择仓库 → 选择分支
3. 提问，Agent 会自动 clone 仓库到本地工作目录
4. Agent 完成修改后自动创建 PR，附 PR 链接到回复

## 项目结构

```
mobile-app/
├── lib/
│   ├── main.dart                      # 应用入口
│   ├── app.dart                      # App 根组件
│   ├── routing/router.dart           # 路由配置
│   ├── core/
│   │   ├── agent/
│   │   │   ├── local_agent_service.dart    # 本地 Agent（流式 + 工具调用）
│   │   │   ├── openai_compatible_model.dart
│   │   │   └── agent_types.dart
│   │   ├── config/mobile_config.dart       # 配置持久化
│   │   ├── github/
│   │   │   ├── github_service.dart         # GitHub API
│   │   │   └── github_browser_auth.dart   # Device Flow 认证弹窗
│   │   ├── workspace/workspace_target.dart
│   │   └── connection/                    # 桌面端连接
│   └── features/
│       ├── chat/
│       │   ├── chat_controller.dart       # 聊天状态 + Agent 调度
│       │   ├── models/
│       │   └── widgets/
│       │       ├── message_bubble.dart
│       │       ├── tool_call_card.dart    # 工具调用 UI
│       │       ├── streaming_text.dart    # 流式输出 UI
│       │       └── markdown_renderer.dart
│       ├── settings/settings_screen.dart   # 设置页（API 配置 + GitHub 认证）
│       └── ...
├── android/                              # Android 原生配置
└── pubspec.yaml                          # Flutter 依赖配置
```

## CI/CD

Android release APK 已集成到 GitHub Actions release 流程（`.github/workflows/build-release.yml` 的 `build-android` job）：

- 触发：推送 `v*` tag 或手动 workflow_dispatch
- 流程：Checkout → Java 17 → Flutter → pub get → patch file_picker compileSdk → build release APK → 上传到 Release
- 产物：`spacecode-mobile-v{version}.apk`
- Client ID 注入：优先读取 GitHub Secret `MOBILE_GITHUB_CLIENT_ID`，否则使用默认值

发布新版本：

```bash
# 1. 更新 pubspec.yaml 的 version 字段
# 2. 提交并打 tag
git tag v0.2.0
git push origin v0.2.0
```

## 开发

### 单元测试

```bash
cd mobile-app
flutter test test/local_agent_service_test.dart
```

### 静态分析

```bash
flutter analyze --no-pub
```

### 已知问题

- **file_picker 8.3.7 兼容性**：插件以 compileSdk 34 构建，与 AGP 9 不兼容。本地构建需手动修改 Pub Cache 中的 `file_picker-*/android/build.gradle`，把 `compileSdk 34` 改为 `compileSdk 36`；CI 中已自动 patch
- **Release 签名**：当前 release 使用 debug 签名，生产发布需配置正式 keystore

## 协议

详见根目录 LICENSE。
