/**
 * #103：Outbox 组合通道。
 *
 * `SuperAgentOutboxChannel` 从单实例升级为按 channel 前缀路由的发送器注册表：
 *  - `desktop` 精确匹配；
 *  - `feishu:` / `github:` 前缀匹配。
 *
 * 未注册的目标直接 gone（dropped 带原因），绝不把外部消息误发到桌面或别的
 * 平台。
 */
import { createSuperAgentFeishuOutboxChannel, createFeishuBotOutboxTransport } from './feishuChannel'
import { createSuperAgentGithubOutboxChannel, createGithubApiOutboxTransport } from './githubChannel'
import type { SuperAgentOutboxChannel, SuperAgentOutboxSendOutcome } from './outbox'

export interface SuperAgentOutboxChannelRegistration {
  /** 精确匹配的 channel（如 `desktop`）。 */
  exact?: string
  /** 前缀匹配（如 `feishu:` / `github:`）。 */
  prefix?: string
  channel: SuperAgentOutboxChannel
}

export function createSuperAgentOutboxChannelRouter(
  registrations: SuperAgentOutboxChannelRegistration[],
): SuperAgentOutboxChannel {
  return async (message): Promise<SuperAgentOutboxSendOutcome> => {
    const registration = registrations.find(({ exact, prefix }) =>
      exact !== undefined
        ? message.channel === exact
        : prefix !== undefined && prefix !== '' && message.channel.startsWith(prefix),
    )
    if (!registration) return { outcome: 'gone', error: 'outboxChannelNotConfigured' }
    return registration.channel(message)
  }
}

/** 生产默认外部通道：复用 electron/im 与 gh CLI 的既有凭据边界。 */
export function createDefaultExternalOutboxChannels(): {
  feishu: SuperAgentOutboxChannel
  github: SuperAgentOutboxChannel
} {
  return {
    feishu: createSuperAgentFeishuOutboxChannel({ send: createFeishuBotOutboxTransport().send }),
    github: createSuperAgentGithubOutboxChannel({ transport: createGithubApiOutboxTransport() }),
  }
}
