import { electronAPI } from './_context'

export const shell = {
  openExternal: (url: string): Promise<void> =>
    electronAPI?.shell?.openExternal(url) || Promise.resolve(),
}
