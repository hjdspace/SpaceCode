/**
 * File-type icon mapping (fileIcons.json) and the offline subset it feeds.
 */
import { describe, it, expect } from 'vitest'
import { getFileIcon, getFileIconName } from '../fileIcons'
import iconMap from '../fileIcons.json'
import generatedSet from '@/assets/vscode-icons.json'

describe('getFileIconName', () => {
  it('resolves by extension', () => {
    expect(getFileIconName('App.vue')).toBe('file-type-vue')
    expect(getFileIconName('MAIN.TS')).toBe('file-type-typescript')
    expect(getFileIconName('index.d.ts')).toBe('file-type-typescript')
  })

  it('prefers an exact filename over the extension', () => {
    expect(getFileIconName('package.json')).toBe('file-type-npm')
    expect(getFileIconName('Cargo.toml')).toBe('file-type-rust')
  })

  it('prefers a config pattern over the extension', () => {
    expect(getFileIconName('tsconfig.json')).toBe('file-type-tsconfig')
    expect(getFileIconName('vite.config.mts')).toBe('file-type-vite')
    expect(getFileIconName('.gitignore')).toBe('file-type-git')
    expect(getFileIconName('user.service.spec.ts')).toBe('file-type-test')
  })

  it('handles extension-less and dot-only names', () => {
    expect(getFileIconName('Dockerfile')).toBe('file-type-docker')
    expect(getFileIconName('LICENSE')).toBe('file-type-license')
    expect(getFileIconName('.env.local')).toBe('file-type-dotenv')
  })

  it('falls back to the default icon', () => {
    expect(getFileIconName('notes.xyz')).toBe(iconMap.default)
    expect(getFileIconName('weird.unknownext')).toBe(iconMap.default)
  })

  it('qualifies names with the collection prefix', () => {
    expect(getFileIcon('main.py')).toBe('vscode-icons:file-type-python')
  })
})

describe('generated icon subset', () => {
  const referenced = [
    ...Object.values(iconMap.names),
    ...iconMap.patterns.map(([, icon]) => icon),
    ...Object.values(iconMap.extensions),
    iconMap.default,
  ]

  it.each([...new Set(referenced)])('ships %s', name => {
    const available = { ...generatedSet.icons, ...generatedSet.aliases }
    expect(Object.keys(available)).toContain(name)
  })

  it('is registered under the prefix the lookup builds', () => {
    expect(generatedSet.prefix).toBe(iconMap.prefix)
  })
})
