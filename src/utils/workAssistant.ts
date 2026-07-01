import type { Component } from 'vue'
import {
  Presentation, FileText, FileSpreadsheet, Sparkles, Rocket, Receipt,
  GraduationCap, Coins, LayoutDashboard, Palette, Gamepad2, BookOpen,
  Box, Drama, Handshake, Brain, Workflow, ListTodo, Wrench, Megaphone, Bot,
  Film, Newspaper,
} from 'lucide-vue-next'

/**
 * 办公助手头像：avatar 字段存 lucide 图标名（kebab-case），此处映射为组件。
 * 兜底返回 Bot 图标，避免空 avatar 时回退到 emoji。
 */
const ICON_MAP: Record<string, Component> = {
  'presentation': Presentation,
  'file-text': FileText,
  'file-spreadsheet': FileSpreadsheet,
  'sparkles': Sparkles,
  'rocket': Rocket,
  'receipt': Receipt,
  'graduation-cap': GraduationCap,
  'coins': Coins,
  'layout-dashboard': LayoutDashboard,
  'palette': Palette,
  'gamepad-2': Gamepad2,
  'book-open': BookOpen,
  'box': Box,
  'drama': Drama,
  'handshake': Handshake,
  'brain': Brain,
  'workflow': Workflow,
  'list-todo': ListTodo,
  'wrench': Wrench,
  'megaphone': Megaphone,
  'film': Film,
  'newspaper': Newspaper,
}

export function workAssistantIcon(avatar?: string): Component {
  if (avatar && ICON_MAP[avatar]) return ICON_MAP[avatar]
  return Bot
}

/** 办公助手分类色（前景色）。 */
export const WORK_CATEGORY_COLORS: Record<string, string> = {
  office: '#3b82f6',
  research: '#6366f1',
  finance: '#10b981',
  design: '#8b5cf6',
  creative: '#ec4899',
  productivity: '#f59e0b',
  general: '#64748b',
}

export function workCategoryColor(category?: string): string {
  return WORK_CATEGORY_COLORS[category || 'general'] || WORK_CATEGORY_COLORS.general
}

/** 头像容器内联样式：分类色淡底 + 分类色前景（图标继承 currentColor）。 */
export function workAvatarStyle(category?: string): Record<string, string> {
  const color = workCategoryColor(category)
  return {
    color,
    background: hexToRgba(color, 0.12),
  }
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('')
  }
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 已知缩写词，显示名中需全大写（PPT / UI / UX / 3D 等）。 */
const ACRONYMS = new Set(['ppt', 'ui', 'ux', '3d', 'ai', 'api', 'sql', 'pdf'])

/** 把 kebab-case 的 name 转为显示名，缩写词保持大写。 */
export function workDisplayName(name: string): string {
  return name
    .split('-')
    .map(w => {
      const lw = w.toLowerCase()
      if (ACRONYMS.has(lw)) return lw.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1)
    })
    .join(' ')
}
