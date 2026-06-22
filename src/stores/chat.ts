import { useChatSessionStore } from './chatSession'
import { useChatStreamStore } from './chatStream'
import { useChatControlStore } from './chatControl'

/**
 * Compose the three chat sub-stores into a single unified API.
 *
 * This is NOT a Pinia store — it delegates to three independent Pinia stores
 * (chatSession, chatStream, chatControl) via an ES6 Proxy.
 *
 * Using a Proxy (instead of spreading) preserves Vue's reactivity tracking:
 * when a component accesses `chatStore.sessions`, the Proxy delegates to
 * `sessionStore.sessions`, and Vue tracks the dependency on the original
 * Pinia store's reactive state.
 *
 * Spreading would unwrap refs to plain values, breaking reactivity and
 * causing bugs like session switching not working or streaming not updating.
 *
 * All consumers use `useChatStore()` exactly as before.
 */

// Pinia internal keys to skip
const SKIP_KEYS = new Set([
  '$id', '$state', '$patch', '$reset', '$subscribe', '$onAction',
  '$dispose', '_customProperties', '_p', '$hydrate', '$trigger',
])

function isPublicKey(key: string): boolean {
  return !SKIP_KEYS.has(key) && !key.startsWith('__')
}

export function useChatStore() {
  const sessionStore = useChatSessionStore()
  const streamStore = useChatStreamStore()
  const controlStore = useChatControlStore()

  const stores = [sessionStore, streamStore, controlStore]

  const handler: ProxyHandler<object> = {
    get(_target, key: string | symbol) {
      if (typeof key === 'symbol') return undefined
      if (!isPublicKey(key)) return undefined
      for (const store of stores) {
        if (key in store) return (store as unknown as Record<string, unknown>)[key]
      }
      return undefined
    },
    has(_target, key: string | symbol) {
      if (typeof key === 'symbol') return false
      if (!isPublicKey(key as string)) return false
      return stores.some(s => key in s)
    },
    ownKeys() {
      const keys = new Set<string>()
      for (const store of stores) {
        for (const key of Object.keys(store)) {
          if (isPublicKey(key)) keys.add(key)
        }
      }
      return [...keys]
    },
    getOwnPropertyDescriptor(_target, key: string | symbol) {
      if (typeof key === 'symbol') return undefined
      if (!isPublicKey(key as string)) return undefined
      for (const store of stores) {
        if (key in store) {
          return { configurable: true, enumerable: true, value: (store as unknown as Record<string, unknown>)[key as string] }
        }
      }
      return undefined
    },
  }

  return new Proxy(Object.create(null), handler) as ChatStoreApi
}

// Pinia internal keys to omit from the public type
type PiniaInternal = '$id' | '$state' | '$patch' | '$reset' | '$subscribe' |
  '$onAction' | '$dispose' | '_customProperties' | '_p' | '$hydrate' | '$trigger'

// Strip Pinia internals from each sub-store type
type StripPinia<T> = Omit<T, PiniaInternal>

// The combined public API of all three sub-stores
type ChatStoreApi = StripPinia<ReturnType<typeof useChatSessionStore>> &
  StripPinia<ReturnType<typeof useChatStreamStore>> &
  StripPinia<ReturnType<typeof useChatControlStore>>

// Re-export sub-stores for direct access when needed
export { useChatSessionStore, useChatStreamStore, useChatControlStore }

// Re-export types that consumers may import from this module
export type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus } from '@/types'
export type { RewindOption, RewindState } from '@/types/rewind'
