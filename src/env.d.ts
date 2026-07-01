/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

interface FileStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: number
}

interface AgentDef {
  name: string
  description: string
  content: string
  tools?: string[]
  model?: string
  color?: string
  sourceDir: string
  agentPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  category: string
  mode?: 'work' | 'code'
  avatar?: string
  permission?: string
  skills?: string[]
  mcps?: string[]
  recommendedPrompts?: string[]
  descriptionZh?: string
  recommendedPromptsZh?: string[]
}

interface Window {
  // electronAPI type is declared in src/types/electron.d.ts
}