export type ProjectKind = 'prototype' | 'deck' | 'other' | 'video' | 'image' | 'audio'

export interface ProjectMetadata {
  kind?: ProjectKind
  fidelity?: 'wireframe' | 'high-fidelity'
  platform?: 'auto'
  platformTargets?: string[]
  intent?: string
}

export interface DesignTemplate {
  id: string
  labelKey: string
  descriptionKey: string
  icon: string
  pluginId: string
  projectKind: ProjectKind
  projectMetadata?: ProjectMetadata
  inputs?: Record<string, unknown>
  defaultSkillId: string
  defaultDesignSystemId?: string
  preambleTemplate: string
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'prototype',
    labelKey: 'design.template.prototype',
    descriptionKey: 'design.template.prototypeDesc',
    icon: 'palette',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成交互式 Web 应用原型，包含可点击的页面流程。',
  },
  {
    id: 'wireframe',
    labelKey: 'design.template.wireframe',
    descriptionKey: 'design.template.wireframeDesc',
    icon: 'layout',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', fidelity: 'wireframe' },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成低保真线框图，只关注信息结构与页面流程，不要高保真视觉。',
  },
  {
    id: 'mobile',
    labelKey: 'design.template.mobile',
    descriptionKey: 'design.template.mobileDesc',
    icon: 'smartphone',
    pluginId: 'example-web-prototype',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', platform: 'auto', platformTargets: ['mobile-ios', 'mobile-android'] },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成 iOS 与 Android 移动应用界面设计。',
  },
  {
    id: 'deck',
    labelKey: 'design.template.deck',
    descriptionKey: 'design.template.deckDesc',
    icon: 'presentation',
    pluginId: 'example-simple-deck',
    projectKind: 'deck',
    defaultSkillId: 'html-ppt-skill',
    preambleTemplate: '请生成一套幻灯片演示文稿。',
  },
  {
    id: 'document',
    labelKey: 'design.template.document',
    descriptionKey: 'design.template.documentDesc',
    icon: 'file-text',
    pluginId: 'od-new-generation',
    projectKind: 'other',
    inputs: { artifactKind: 'document', audience: 'readers', topic: 'the user brief' },
    projectMetadata: { kind: 'other', intent: 'document' },
    defaultSkillId: 'officecli-docx',
    preambleTemplate: '请生成一份文档（简历、报告或 PDF）。',
  },
  {
    id: 'hyperframes',
    labelKey: 'design.template.hyperframes',
    descriptionKey: 'design.template.hyperframesDesc',
    icon: 'orbit',
    pluginId: 'example-hyperframes',
    projectKind: 'video',
    defaultSkillId: 'canvas-design',
    preambleTemplate: '请生成基于 HTML 的动态图形或循环动画。',
  },
  {
    id: 'live-artifact',
    labelKey: 'design.template.liveArtifact',
    descriptionKey: 'design.template.liveArtifactDesc',
    icon: 'activity',
    pluginId: 'example-live-artifact',
    projectKind: 'prototype',
    projectMetadata: { kind: 'prototype', intent: 'live-artifact', fidelity: 'high-fidelity' },
    defaultSkillId: 'ui-ux-pro-max',
    preambleTemplate: '请生成一个数据驱动的实时看板。',
  },
  {
    id: 'image',
    labelKey: 'design.template.image',
    descriptionKey: 'design.template.imageDesc',
    icon: 'image',
    pluginId: 'od-media-generation',
    projectKind: 'image',
    inputs: { mediaKind: 'image', subject: 'a polished product concept', style: 'cinematic, high-quality, on-brand', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一张海报、图形或插画。',
  },
  {
    id: 'video',
    labelKey: 'design.template.video',
    descriptionKey: 'design.template.videoDesc',
    icon: 'video',
    pluginId: 'od-media-generation',
    projectKind: 'video',
    inputs: { mediaKind: 'video', subject: 'a short product reveal', style: 'cinematic, high-quality, on-brand', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成一个短视频、Reels 或宣传片。',
  },
  {
    id: 'audio',
    labelKey: 'design.template.audio',
    descriptionKey: 'design.template.audioDesc',
    icon: 'audio-waveform',
    pluginId: 'od-media-generation',
    projectKind: 'audio',
    inputs: { mediaKind: 'audio', subject: 'a concise audio identity for a product', style: 'clear, polished, modern', aspect: '16:9' },
    defaultSkillId: 'huashu-design',
    preambleTemplate: '请生成音频相关设计或配音脚本。',
  },
]

export function getTemplateById(id: string | null): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find((t) => t.id === id)
}

export function buildPreamble(
  templateId: string | null,
  designSystemName: string | null,
): string {
  const template = getTemplateById(templateId)
  if (!template) return ''
  const meta = template.projectMetadata
  const signals: string[] = []
  if (meta?.fidelity) signals.push(`fidelity=${meta.fidelity}`)
  if (meta?.platformTargets?.length) signals.push(`platform=${meta.platformTargets.join(',')}`)
  if (meta?.intent) signals.push(`intent=${meta.intent}`)
  if (template.inputs) {
    for (const [k, v] of Object.entries(template.inputs)) {
      signals.push(`${k}=${v}`)
    }
  }
  const metaPart = signals.length ? ` [${signals.join('; ')}]` : ''
  const systemPart = designSystemName ? ` 使用 ${designSystemName} 设计系统。` : ''
  return `${template.preambleTemplate}${metaPart}${systemPart}`
}
