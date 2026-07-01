/**
 * 厂商 Base URL 预设数据
 *
 * 提供 OpenAI / Anthropic / Gemini 三种 API 兼容模式下的常见厂商预设地址。
 * 图标使用 SVG 文件（通过 Vite ?raw 导入，保留原生品牌色）或 PNG 图片。
 */

// ── SVG 图标（完整 SVG 标记，包含原生颜色） ──
import openaiSvg from '@/assets/logos/openai.svg?raw'
import anthropicSvg from '@/assets/logos/anthropic.svg?raw'
import deepseekSvg from '@/assets/logos/deepseek.svg?raw'
import geminiSvg from '@/assets/logos/gemini.svg?raw'
import grokSvg from '@/assets/logos/grok.svg?raw'
import minimaxSvg from '@/assets/logos/minimax.svg?raw'
import mimoSvg from '@/assets/logos/mimo.svg?raw'
import zhipuSvg from '@/assets/logos/zhipu.svg?raw'
import sensenovaSvg from '@/assets/logos/sensenova.svg?raw'
import volcengineSvg from '@/assets/logos/volcengine.svg?raw'
import qwenSvg from '@/assets/logos/qwen.svg?raw'

// ── PNG 图标 ──
import kimiImg from '@/assets/logos/kimi.png'

/** 图标类型 */
export type LogoType = 'svgRaw' | 'img'

/** 徽章类型 */
export type BadgeType = 'recommended' | 'official' | null

/** 厂商预设 */
export interface ProviderPreset {
  id: string
  name: string
  nameEn: string
  baseUrl: string
  badge: string | null
  badgeType: BadgeType
  logoType: LogoType
  /** 完整 SVG 标记字符串（logoType === 'svgRaw' 时使用） */
  svgRaw?: string
  /** 图片 URL（logoType === 'img' 时使用） */
  logoSrc?: string
  /** 品牌 CSS 类名（用于 currentColor 图标的颜色设置） */
  logoClass: string
  website: string
}

/** 认证模式 → 厂商预设列表 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset[]> = {
  openai_compatible: [
    {
      id: 'openai',
      name: 'OpenAI',
      nameEn: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      badge: 'recommended',
      badgeType: 'recommended',
      logoType: 'svgRaw',
      svgRaw: openaiSvg,
      logoClass: 'brand-openai',
      website: 'openai.com',
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      nameEn: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      badge: 'recommended',
      badgeType: 'recommended',
      logoType: 'svgRaw',
      svgRaw: deepseekSvg,
      logoClass: 'brand-deepseek',
      website: 'deepseek.com',
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      nameEn: 'Zhipu GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: zhipuSvg,
      logoClass: 'brand-zhipu',
      website: 'bigmodel.cn',
    },
    {
      id: 'minimax',
      name: 'MiniMax',
      nameEn: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: minimaxSvg,
      logoClass: 'brand-minimax',
      website: 'minimax.chat',
    },
    {
      id: 'kimi',
      name: 'Kimi (月之暗面)',
      nameEn: 'Moonshot Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      badge: null,
      badgeType: null,
      logoType: 'img',
      logoSrc: kimiImg,
      logoClass: 'brand-kimi',
      website: 'moonshot.cn',
    },
    {
      id: 'sensetime',
      name: '商汤日日新',
      nameEn: 'SenseTime SenseNova',
      baseUrl: 'https://token.sensenova.cn/v1',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: sensenovaSvg,
      logoClass: 'brand-sensetime',
      website: 'sensenova.cn',
    },
    {
      id: 'mimo',
      name: '小米 MiMo',
      nameEn: 'Xiaomi MiMo',
      baseUrl: 'https://api.xiaomimimo.com/v1',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: mimoSvg,
      logoClass: 'brand-mimo',
      website: 'xiaomimimo.com',
    },
    {
      id: 'grok',
      name: 'Grok (xAI)',
      nameEn: 'xAI Grok',
      baseUrl: 'https://api.x.ai/v1',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: grokSvg,
      logoClass: 'brand-grok',
      website: 'x.ai',
    },
    {
      id: 'volcengine',
      name: '火山引擎 (豆包)',
      nameEn: 'Volcano Engine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: volcengineSvg,
      logoClass: 'brand-volcengine',
      website: 'volcengine.com',
    },
    {
      id: 'qwen',
      name: '通义千问',
      nameEn: 'Alibaba Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: qwenSvg,
      logoClass: 'brand-qwen',
      website: 'aliyun.com',
    },
  ],

  anthropic_compatible: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      nameEn: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      badge: 'official',
      badgeType: 'official',
      logoType: 'svgRaw',
      svgRaw: anthropicSvg,
      logoClass: 'brand-anthropic',
      website: 'anthropic.com',
    },
    {
      id: 'zhipu-anthropic',
      name: '智谱 GLM',
      nameEn: 'Zhipu GLM (Anthropic Compatible)',
      baseUrl: 'https://open.zhipuai.cn/anthropic',
      badge: 'recommended',
      badgeType: 'recommended',
      logoType: 'svgRaw',
      svgRaw: zhipuSvg,
      logoClass: 'brand-zhipu',
      website: 'zhipuai.cn',
    },
    {
      id: 'kimi-anthropic',
      name: 'Kimi K2 (Anthropic 兼容)',
      nameEn: 'Moonshot Kimi (Anthropic Compatible)',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      badge: null,
      badgeType: null,
      logoType: 'img',
      logoSrc: kimiImg,
      logoClass: 'brand-kimi',
      website: 'moonshot.cn',
    },
    {
      id: 'mimo-anthropic',
      name: '小米 MiMo (Anthropic 兼容)',
      nameEn: 'Xiaomi MiMo (Anthropic Compatible)',
      baseUrl: 'https://api.xiaomimimo.com/anthropic',
      badge: null,
      badgeType: null,
      logoType: 'svgRaw',
      svgRaw: mimoSvg,
      logoClass: 'brand-mimo',
      website: 'xiaomimimo.com',
    },
  ],

  gemini_api: [
    {
      id: 'gemini',
      name: 'Google Gemini',
      nameEn: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      badge: 'official',
      badgeType: 'official',
      logoType: 'svgRaw',
      svgRaw: geminiSvg,
      logoClass: 'brand-gemini',
      website: 'ai.google.dev',
    },
  ],
}
