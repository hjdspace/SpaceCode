import { electronAPI } from './_context'

export const skills = {
  getSkills: (cwd?: string): Promise<any> =>
    electronAPI?.skills?.getSkills(cwd) || Promise.resolve({ skills: [] }),
  getBundledSkills: (): Promise<any> =>
    electronAPI?.skills?.getBundledSkills() || Promise.resolve({ skills: [] }),
  createSkill: (name: string, scope: string, content: string, cwd?: string): Promise<any> =>
    electronAPI?.skills?.createSkill(name, scope, content, cwd) || Promise.resolve(null),
  saveSkill: (skill: unknown, content: string): Promise<any> =>
    electronAPI?.skills?.saveSkill(skill, content) || Promise.resolve(null),
  deleteSkill: (filePath: string): Promise<void> =>
    electronAPI?.skills?.deleteSkill(filePath) || Promise.resolve(),
  searchMarketplace: (query: string): Promise<any> =>
    electronAPI?.skills?.searchMarketplace(query) || Promise.resolve({ skills: [] }),
  installMarketplaceSkill: (source: string, skillId: string, global: boolean, cwd?: string): Promise<any> =>
    electronAPI?.skills?.installMarketplaceSkill(source, skillId, global, cwd) || Promise.resolve({ success: false }),
  uninstallMarketplaceSkill: (skillName: string, global: boolean, cwd?: string): Promise<void> =>
    electronAPI?.skills?.uninstallMarketplaceSkill(skillName, global, cwd) || Promise.resolve(),
  fetchMarketplaceReadme: (source: string, skillId: string): Promise<string | null> =>
    electronAPI?.skills?.fetchMarketplaceReadme(source, skillId) || Promise.resolve(null),
  scanLocalLibrary: (dirPaths: string[], cwd?: string): Promise<any> =>
    electronAPI?.skills?.scanLocalLibrary(dirPaths, cwd) || Promise.resolve({ skills: [], bundles: [] }),
  installLocal: (skillName: string, scope: string, cwd?: string, skillPath?: string): Promise<void> =>
    electronAPI?.skills?.installLocal(skillName, scope, cwd, skillPath) || Promise.resolve(),
  uninstallLocal: (skillName: string, cwd?: string): Promise<void> =>
    electronAPI?.skills?.uninstallLocal(skillName, cwd) || Promise.resolve(),
  installLocalBundle: (bundleId: string, scope: string, cwd?: string): Promise<void> =>
    electronAPI?.skills?.installLocalBundle(bundleId, scope, cwd) || Promise.resolve(),
  uninstallLocalBundle: (bundleName: string, cwd?: string): Promise<void> =>
    electronAPI?.skills?.uninstallLocalBundle(bundleName, cwd) || Promise.resolve(),
  addCustomDir: (dirPath: string): Promise<void> =>
    electronAPI?.skills?.addCustomDir(dirPath) || Promise.resolve(),
  removeCustomDir: (dirPath: string): Promise<void> =>
    electronAPI?.skills?.removeCustomDir(dirPath) || Promise.resolve(),
  getCustomDirs: (): Promise<any> =>
    electronAPI?.skills?.getCustomDirs() || Promise.resolve({ directories: [] }),
}
