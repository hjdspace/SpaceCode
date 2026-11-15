import { electronAPI, _isH5Mode } from './_context'

export const shell = {
  openExternal: (url: string): Promise<void> => {
    if (electronAPI?.shell?.openExternal) return electronAPI.shell.openExternal(url)
    // H5 没有主进程 Shell：用浏览器新标签页打开。调用方（预览桥）已按 http/https 过滤，
    // 这里不开 window.opener，避免被打开页反向控制预览页。
    if (_isH5Mode && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    return Promise.resolve()
  },

  /** H5 没有主进程 Shell，也没有资源管理器可定位 —— 卡片据此把按钮置灰而不是点了报错。 */
  canShowItemInFolder: Boolean(electronAPI?.shell?.showItemInFolder),

  showItemInFolder: (path: string): Promise<void> => {
    if (electronAPI?.shell?.showItemInFolder) return electronAPI.shell.showItemInFolder(path)
    return Promise.resolve()
  },
}
