// 三个独立 store 是真实边界；本文件保留旧入口的兼容 facade。
// 部分组件仍从 '@/stores/chat' 读取合并后的 chat/turn 状态，直接删除
// useChatStore 会导致 ESM named export 运行时错误。
import { useChatSessionStore } from './chatSession'
import { useTurnStore as useTurnStateStore } from './turn'
import { usePermissionPolicyStore } from './permissionPolicy'

export { useChatSessionStore, usePermissionPolicyStore }

type MergeStores<Base, Override> = Omit<Base, keyof Override> & Override

type ChatStoreFacade =
  MergeStores<
    MergeStores<ReturnType<typeof usePermissionPolicyStore>, ReturnType<typeof useChatSessionStore>>,
    ReturnType<typeof useTurnStateStore>
  >

function createChatStoreFacade(): ChatStoreFacade {
  const sessionStore = useChatSessionStore()
  const turnStore = useTurnStateStore()
  const permissionPolicyStore = usePermissionPolicyStore()
  const stores = [turnStore, sessionStore, permissionPolicyStore] as const

  return new Proxy({} as ChatStoreFacade, {
    get(_target, property) {
      for (const store of stores) {
        if (property in store) {
          return Reflect.get(store, property)
        }
      }
      return undefined
    },
    set(_target, property, value) {
      for (const store of stores) {
        if (property in store) {
          return Reflect.set(store, property, value)
        }
      }
      return false
    },
    has(_target, property) {
      return stores.some(store => property in store)
    },
    ownKeys() {
      return Array.from(new Set(stores.flatMap(store => Reflect.ownKeys(store))))
    },
    getOwnPropertyDescriptor(_target, property) {
      for (const store of stores) {
        const descriptor = Reflect.getOwnPropertyDescriptor(store, property)
        if (descriptor) return { ...descriptor, configurable: true }
      }
      return undefined
    },
  })
}

export function useChatStore(): ChatStoreFacade {
  return createChatStoreFacade()
}

// Compatibility: several call sites imported useTurnStore from this barrel while
// still reading session fields from it. Keep the barrel behavior broad; import
// from './turn' directly when only the turn store is desired.
export function useTurnStore(): ChatStoreFacade {
  return createChatStoreFacade()
}

// 兼容：部分消费方仍 import 类型
export type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus } from '@/types'
export type { RewindOption, RewindState } from '@/types/rewind'
