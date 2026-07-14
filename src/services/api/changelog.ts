import { electronAPI } from './_context'

export const changelog = {
  getReleaseNotes: (version: string): Promise<{ content: string; source: 'local' | 'remote' } | null> => {
    if (electronAPI?.changelog?.getReleaseNotes) {
      return electronAPI.changelog.getReleaseNotes(version)
    }
    return Promise.resolve(null)
  },
}
