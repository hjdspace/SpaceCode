# Light 主题优化设计 — Mist Slate 雾石板

## 选定方案

**方案 B: Mist Slate 雾石板**

## 设计意图

中性色向冷蓝方向微偏（chroma ~0.008），营造雾面石板般的冷静质感。主色采用 Teal 青绿 `#0d9488`，彻底打破"AI 工具 = 蓝色"的第一反射。整体感觉专业、克制、有辨识度。

## 场景句

开发者在明亮的大开间工作室中，阴天柔和漫射光透过落地窗洒入，需要一种冷静但不冰冷的界面来专注处理复杂的系统架构问题。

## 色彩策略

Restrained: 染色中性色 + 一个强调色占比 <=10%

## 变量变更对照

### 背景层级

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --bg-primary | #ffffff | #f8f9fb |
| --bg-secondary | #fafafa | #f0f1f5 |
| --bg-tertiary | #f5f5f5 | #e7e9ef |
| --bg-elevated | #ffffff | #ffffff |
| --bg-hover | #f0f0f0 | #e4e6ec |
| --bg-active | #e8e8e8 | #dbdde5 |

### 扩展表面系统

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --surface-soft | #fafafa | #f3f4f8 |
| --surface-card | #f5f5f5 | #ecedf2 |
| --surface-strong | #eeeeee | #e3e5ec |

### 文字层级

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --text-primary | #171717 | #18191f |
| --text-secondary | #525252 | #44475a |
| --text-muted | #737373 | #6e7191 |
| --text-disabled | #a3a3a3 | #9da1b8 |

### 主色调

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --accent-primary | #2563eb | #0d9488 |
| --accent-primary-hover | #3b82f6 | #14b8a6 |
| --accent-primary-glow | rgba(37,99,235,0.15) | rgba(13,148,136,0.12) |

### 辅助色调

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --accent-secondary | #64748b | #6366f1 |
| --accent-secondary-hover | #475569 | #818cf8 |
| --accent-secondary-glow | rgba(100,116,139,0.15) | rgba(99,102,241,0.12) |

### 语义色

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --success | #16a34a | #059669 |
| --success-glow | rgba(22,163,74,0.15) | rgba(5,150,105,0.15) |
| --warning | #d97706 | #d97706 |
| --warning-glow | rgba(217,119,6,0.15) | rgba(217,119,6,0.15) |
| --error | #dc2626 | #dc2626 |
| --error-glow | rgba(220,38,38,0.15) | rgba(220,38,38,0.15) |

### 边框系统

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --border-subtle | rgba(0,0,0,0.04) | rgba(24,25,31,0.05) |
| --border-default | rgba(0,0,0,0.08) | rgba(24,25,31,0.09) |
| --border-strong | rgba(0,0,0,0.15) | rgba(24,25,31,0.15) |

### 阴影系统

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --shadow-sm | 0 1px 2px rgba(0,0,0,0.05) | 0 1px 2px rgba(24,25,31,0.06) |
| --shadow-md | 0 4px 12px rgba(0,0,0,0.08) | 0 4px 12px rgba(24,25,31,0.08) |
| --shadow-lg | 0 8px 24px rgba(0,0,0,0.12) | 0 8px 24px rgba(24,25,31,0.11) |
| --shadow-xl | 0 16px 48px rgba(0,0,0,0.16) | 0 16px 48px rgba(24,25,31,0.14) |
| --shadow-glow | 0 0 15px rgba(37,99,235,0.15) | 0 0 15px rgba(13,148,136,0.12) |

### 代码高亮

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --code-bg | var(--bg-tertiary) | #eef0f5 |
| --code-fg | #24292f | #18191f |
| --code-keyword | #cf222e | #be123c |
| --code-string | #0a3069 | #1e40af |
| --code-number | #0550ae | #7c3aed |
| --code-comment | #6e7781 | #6e7191 |
| --code-function | #8250df | #0d9488 |
| --code-builtin | #953800 | #0d9488 |
| --code-attr | #0550ae | #6366f1 |
| --code-tag | #116329 | #059669 |
| --code-punctuation | #24292f | #44475a |
| --code-meta | #6e7781 | #6e7191 |

### Git Diff

| 变量 | 当前值 | 新值 |
|------|--------|------|
| --gdc-bg-color | #ffffff | #f8f9fb |
| --gdc-text-color | #24292f | #18191f |
| --gdc-border-color | #d0d7de | #d0d5de |
| --gdc-add-bg-color | rgba(35,134,54,0.15) | rgba(5,150,105,0.12) |
| --gdc-add-text-color | #1a7f37 | #059669 |
| --gdc-add-gutter-bg-color | rgba(35,134,54,0.15) | rgba(5,150,105,0.1) |
| --gdc-remove-bg-color | rgba(218,53,52,0.12) | rgba(220,38,38,0.1) |
| --gdc-remove-text-color | #cf222e | #dc2626 |
| --gdc-remove-gutter-bg-color | rgba(218,53,52,0.08) | rgba(220,38,38,0.07) |
| --gdc-gutter-bg-color | #f6f8fa | #f0f1f5 |
| --gdc-gutter-text-color | #6e7781 | #6e7191 |

### SCSS 变量同步

以下 SCSS 变量也需同步更新（用于编译时计算）：

| 变量 | 当前值 | 新值 |
|------|--------|------|
| $accent-primary | #2563eb | #0d9488 |
| $accent-primary-hover | #3b82f6 | #14b8a6 |
| $accent-primary-glow | rgba(37,99,235,0.15) | rgba(13,148,136,0.12) |
| $accent-secondary | #64748b | #6366f1 |
| $accent-secondary-hover | #475569 | #818cf8 |
| $accent-secondary-glow | rgba(100,116,139,0.15) | rgba(99,102,241,0.12) |
| $success | #16a34a | #059669 |
| $success-glow | rgba(22,163,74,0.15) | rgba(5,150,105,0.15) |
| $shadow-glow | 0 0 15px $accent-primary-glow | 0 0 15px $accent-primary-glow |

## 影响范围

1. `_variables.scss` — Light 主题 `:root` 变量 + SCSS 编译时变量
2. 所有通过 `var(--xxx)` 引用主题变量的组件自动生效
3. 无需修改组件代码

## 不影响

- Dark 主题 (`[data-theme='dark']`)
- Anthropic 主题 (`[data-theme='anthropic']`)
- Anthropic Dark 主题 (`[data-theme='anthropic-dark']`)
- 终端 TUI 主题系统
- Web 远程控制面板主题系统
