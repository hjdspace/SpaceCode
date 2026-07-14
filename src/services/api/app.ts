import { electronAPI } from './_context'

export const app = {
  getPath: (name: string): Promise<string> =>
    electronAPI?.app?.getPath(name) || Promise.resolve(''),
}
