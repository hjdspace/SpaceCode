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
}
