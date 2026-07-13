// src/types/pet.ts

export type BuiltinSpecies =
  | 'duck' | 'goose' | 'blob' | 'cat' | 'dragon' | 'octopus'
  | 'owl' | 'penguin' | 'turtle' | 'snail' | 'ghost' | 'axolotl'
  | 'capybara' | 'cactus' | 'robot' | 'rabbit' | 'mushroom' | 'chonk'

export type PetVisualSource =
  | { type: 'builtin-svg'; species: BuiltinSpecies }
  | { type: 'image'; path: string; frameCount?: 1 | 2 }
  | { type: 'emoji'; glyph: string }

export interface PetPalette {
  primary: string
  accent: string
  background?: string
}

export type PetReactionTrigger = 'idle' | 'typing' | 'error' | 'success' | 'petted'

export interface PresetReactions {
  idle: string[]
  typing: string[]
  error: string[]
  success: string[]
  petted: string[]
}

export type PetRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface Pet {
  id: string
  name: string
  personality: string
  visual: PetVisualSource
  palette?: PetPalette
  presetReactions: PresetReactions
  rarity?: PetRarity
  createdAt?: number
}

export interface PetRuntimeState {
  currentReaction: string | null
  reactionAt: number | null
  isPetted: boolean
  animationFrame: number
  isDragging: boolean
}

export type PetMode = 'embedded' | 'desktop'

export type ReactionMode = 'preset' | 'ai'

export interface PetSettings {
  reactionMode: ReactionMode
  aiModel: string
  reactionIntervalMs: number
  muted: boolean
  scale: number
  alwaysOnTopDesktop: boolean
  clickThrough: boolean
}

export interface PetConfig {
  version: number
  activePetId: string
  mode: PetMode
  embeddedPosition: { x: number; y: number }
  desktopWindow: { x: number; y: number; width: number; height: number }
  settings: PetSettings
  customPets: Pet[]
}

export interface PetSyncPayload {
  pet: Pet
  runtimeState: PetRuntimeState
  settings: PetSettings
  locale: 'zh-CN' | 'en-US'
}

export type PetWindowEvent =
  | { type: 'drag'; deltaX: number; deltaY: number }
  | { type: 'drag-end' }
  | { type: 'click' }
  | { type: 'double-click' }
  | { type: 'right-click' }

export interface PetReactionRequest {
  petName: string
  personality: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  trigger: PetReactionTrigger
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  reactionMode: 'preset',
  aiModel: '',
  reactionIntervalMs: 60000,
  muted: false,
  scale: 1.0,
  alwaysOnTopDesktop: true,
  clickThrough: false,
}

export const DEFAULT_PET_RUNTIME_STATE: PetRuntimeState = {
  currentReaction: null,
  reactionAt: null,
  isPetted: false,
  animationFrame: 0,
  isDragging: false,
}
