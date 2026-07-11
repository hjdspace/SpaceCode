/**
 * TypingIndicator — WeChat typing indicator manager
 *
 * WeChat requires re-sending typing indicators every 5 seconds
 * while the bot is generating a response.
 *
 * This module manages a per-chatId timer that sends typing
 * indicators at 5s intervals until stopped.
 */

import type { WechatBot } from './wechatBot'
import { createLogger } from '../common/logger'

const log = createLogger('TypingIndicator')

const TYPING_INTERVAL_MS = 5000

export class TypingIndicator {
  private bot: WechatBot
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map()

  constructor(bot: WechatBot) {
    this.bot = bot
  }

  /** Start sending typing indicators to a user. */
  start(userId: string): void {
    if (this.timers.has(userId)) return

    // Send immediately
    this.bot.sendTyping(userId).catch(() => {})

    const timer = setInterval(() => {
      this.bot.sendTyping(userId).catch((err) => {
        log.warn('start', `Typing indicator failed for ${userId}: ${String(err)}`)
      })
    }, TYPING_INTERVAL_MS)

    if (timer.unref) timer.unref()

    this.timers.set(userId, timer)
    log.info('start', `Typing indicators started for ${userId}`)
  }

  /** Stop sending typing indicators to a user. */
  stop(userId: string): void {
    const timer = this.timers.get(userId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(userId)
      log.info('stop', `Typing indicators stopped for ${userId}`)
    }
  }

  /** Stop all typing indicators. */
  stopAll(): void {
    for (const [userId, timer] of this.timers) {
      clearInterval(timer)
      log.info('stopAll', `Typing indicators stopped for ${userId}`)
    }
    this.timers.clear()
  }
}
