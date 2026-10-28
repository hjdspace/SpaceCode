import { electronAPI } from './_context'

export const paste = {
  /**
   * 长文本粘贴落盘到临时目录。
   * H5 / 纯浏览器环境没有该 IPC，返回失败，调用方回退为行内插入。
   */
  saveText: (text: string): Promise<{ success: boolean; path?: string; size?: number; error?: string }> =>
    electronAPI?.paste?.saveText(text) || Promise.resolve({ success: false, error: 'paste API not available' }),
}
