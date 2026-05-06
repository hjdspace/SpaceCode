declare module '@mariozechner/pi-coding-agent' {
  export class AuthStorage {
    static create(): AuthStorage
    setApiKey(provider: string, apiKey: string): Promise<void>
  }

  export class ModelRegistry {
    static create(authStorage: AuthStorage): ModelRegistry
    getAvailable(): Promise<Array<{ id: string; name: string }>>
  }

  export interface AgentSession {
    prompt(content: string): Promise<void>
    subscribe(callback: (event: any) => void): () => void
  }

  export interface PiConfig {
    cwd: string
    authStorage: AuthStorage
    modelRegistry: ModelRegistry
    model?: any
    thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  }

  export function createAgentSession(config: PiConfig): Promise<{ session: AgentSession }>
}
