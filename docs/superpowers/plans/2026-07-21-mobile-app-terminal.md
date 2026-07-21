# mobile-app 聊天输入框增强实现计划

> 实际执行已偏离原 `mobile-app/.superpowers/brainstorm/mobile-chat-input/plan.md`：
> - 用户要求按截图实现 UI，并额外要求实现语音按钮（非仅占位）。
> - 用户同意删除旧的 workspace toolbar。
> - 最终 chat_input.dart 工具栏使用水平滚动避免宽屏溢出。
> 本文件记录最终落地版本。

## 实现状态

| 功能 | 状态 | 关键文件 |
|------|------|----------|
| `@` 上下文 | ✅ | `mention_picker.dart`, `chat_input.dart` |
| `/` 斜杠命令 | ✅ | `command_menu.dart`, `chat_input.dart` |
| `+` 附件抽屉 | ✅ | `attachment_picker_sheet.dart`, `chat_input.dart` |
| 模型切换 | ✅ | `model_provider.dart`, `model_selector.dart` |
| 语音输入 | ✅ | `pubspec.yaml` + `speech_to_text` + 权限配置 |
| 截图风格 UI | ✅ | `chat_input.dart` 白底圆角卡片 + 工具栏 |

## 关键 commit

- `7a469a9bc` feat(mobile/chat): 添加聊天附件数据模型
- `f26c74188` feat(mobile/chat): 新增 ModelService 与 modelsProvider
- `b0dc0ef4`  feat(config): 支持单独保存当前模型
- `98c727997` feat(mobile chat): 扩展 ChatState / ChatNotifier 支持附件与模型切换
- `2d8b804ba` feat(chat): 创建附件 Chip 组件
- `b6ac12422` feat(mobile-app): 创建聊天附件选择底部抽屉
- `de3d323ee` feat(mobile-app/chat): 创建 @ mention 选择浮层
- `4470c997b` feat(chat): 使用 CommandMenu 替换 SkillCommandMenu 并支持命令分组
- `9e57e0b7a` feat(mobile-app/chat): 创建模型选择器组件
- `ea391bb7f` feat(mobile-app/chat): 重写聊天输入框组件
- `6055d0aec` feat(mobile-app/chat): 补全聊天输入框 i18n 字典并新增 widget 测试
- （修复宽屏溢出）chat_input.dart 工具栏改为水平滚动

## 验证结果

- `flutter test`: 153/153 passed
- `flutter build apk --debug`: built `build/app/outputs/flutter-apk/app-debug.apk`
- `flutter analyze`: 11 info-level issues, all pre-existing and unrelated to this feature
