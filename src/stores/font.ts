import { defineStore } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from './settings'

const fontFamilyMap: Record<string, string> = {
  'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'inter': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  'sf-pro': '"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
  'segoe': '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif'
}

const codeFontMap: Record<string, string> = {
  'jetbrains': '"JetBrains Mono", "Fira Code", monospace',
  'fira': '"Fira Code", "JetBrains Mono", monospace',
  'cascadia': '"Cascadia Code", "Fira Code", monospace',
  'source-code': '"Source Code Pro", monospace',
  'consolas': 'Consolas, Monaco, monospace'
}

export const useFontStore = defineStore('font', () => {
  const settingsStore = useSettingsStore()

  function applyFontSettings() {
    const { fontSize, fontFamily, codeFontFamily } = settingsStore.appearance

    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
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
