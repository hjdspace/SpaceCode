// electron/preload/index.ts
// Preload 装配层：按域创建 electronAPI 并一次性暴露到 window。
// 域内部只依赖 ipcRenderer，不互相引用；新增域在这里追加一行展开即可。

import { contextBridge, ipcRenderer } from 'electron'
import { createCoreApi } from './core'
import { createFsApi } from './fs'
import { createSessionApi } from './session'
import { createToolsApi } from './tools'
import { createIntegrationsApi } from './integrations'
import { createSkillManagerApi } from './skillManager'

contextBridge.exposeInMainWorld('electronAPI', {
  ...createCoreApi(ipcRenderer),
  ...createFsApi(ipcRenderer),
  ...createSessionApi(ipcRenderer),
  ...createToolsApi(ipcRenderer),
  ...createIntegrationsApi(ipcRenderer),
  ...createSkillManagerApi(ipcRenderer),
})
