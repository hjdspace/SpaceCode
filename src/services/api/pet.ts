// src/services/api/pet.ts
import type { PetConfig, PetSyncPayload, PetReactionRequest, PetWindowEvent } from '@/types/pet'

export const petApi = {
  readConfig: (): Promise<PetConfig | null> =>
    window.electronAPI!.pet.readConfig(),

  writeConfig: (config: PetConfig): Promise<void> =>
    window.electronAPI!.pet.writeConfig(config),

  saveAsset: (srcPath: string, petId: string): Promise<string> =>
    window.electronAPI!.pet.saveAsset(srcPath, petId),

  deleteAsset: (relativePath: string): Promise<void> =>
    window.electronAPI!.pet.deleteAsset(relativePath),

  generateReaction: (req: PetReactionRequest): Promise<string | null> =>
    window.electronAPI!.pet.generateReaction(req),

  onWindowEvent: (callback: (event: PetWindowEvent) => void): (() => void) =>
    window.electronAPI!.pet.onWindowEvent(callback),
}
