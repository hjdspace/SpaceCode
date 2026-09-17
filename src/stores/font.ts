import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from './settings'

/** 设置字号以 14px 为基准换算为全局缩放系数 (--font-scale), 类型阶梯整体等比缩放。 */
const FONT_SCALE_BASE_PX = 14

const fontFamilyMap: Record<string, string> = {
  'system': '"Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  'inter': '"Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
  'sf-pro': '"SF Pro Display", "Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
  'segoe': '"Segoe UI", "Inter", "Noto Sans SC", Tahoma, Geneva, Verdana, sans-serif'
}

const codeFontMap: Record<string, string> = {
  'jetbrains': '"JetBrains Mono", "Fira Code", "Noto Sans SC", monospace',
  'fira': '"Fira Code", "JetBrains Mono", "Noto Sans SC", monospace',
  'cascadia': '"Cascadia Code", "Fira Code", "Noto Sans SC", monospace',
  'source-code': '"Source Code Pro", "JetBrains Mono", "Noto Sans SC", monospace',
  'consolas': 'Consolas, Monaco, "Noto Sans SC", monospace'
}

export const useFontStore = defineStore('font', () => {
  const settingsStore = useSettingsStore()

  function applyFontSettings() {
    const { fontSize, fontFamily, codeFontFamily } = settingsStore.appearance

    document.documentElement.style.setProperty(
      '--font-scale',
      String(fontSize / FONT_SCALE_BASE_PX)
    )
    // --font-size-base 保留为旧引用的兼容值 (正文基准 14px * scale)。
    document.documentElement.style.setProperty(
      '--font-size-base',
      `calc(${FONT_SCALE_BASE_PX}px * ${fontSize / FONT_SCALE_BASE_PX})`
    )
    document.documentElement.style.setProperty(
      '--font-body',
      fontFamilyMap[fontFamily] || fontFamilyMap['system']
    )
    document.documentElement.style.setProperty(
      '--font-mono',
      codeFontMap[codeFontFamily] || codeFontMap['jetbrains']
    )
    document.documentElement.style.setProperty(
      '--font-display',
      fontFamilyMap[fontFamily] || fontFamilyMap['system']
    )
  }

  watch(
    () => ({
      fontSize: settingsStore.appearance.fontSize,
      fontFamily: settingsStore.appearance.fontFamily,
      codeFontFamily: settingsStore.appearance.codeFontFamily
    }),
    () => {
      applyFontSettings()
    },
    { immediate: true }
  )

  return {
    applyFontSettings
  }
})
