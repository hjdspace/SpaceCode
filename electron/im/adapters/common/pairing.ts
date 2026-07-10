/**
 * Pairing — Pairing code authorization
 *
 * Generates 6-character pairing codes using a safe alphabet (excludes
 * ambiguous characters like 0/O/1/I/L). Codes are:
 * - One-time use (cleared after successful pairing)
 * - Time-limited (60 minutes TTL)
 * - Rate-limited (5 attempts per 5 minutes per userId)
 *
 * Security: 32^6 ≈ 10^9 code space, combined with rate limiting,
 * brute force is infeasible.
 */

import * as crypto from 'crypto'

// Safe alphabet: excludes 0/O/1/I/L to avoid confusion
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

const CODE_LENGTH = 6
const CODE_TTL_MS = 60 * 60 * 1000 // 60 minutes
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5

export interface PairedUser {
  userId: string
  displayName?: string
  pairedAt: number
}

export interface PairingState {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export interface PairingConfig {
  pairing: PairingState
  pairedUsers: PairedUser[]
}

interface FailedAttempt {
  timestamp: number
}

export interface PairingResult {
  success: boolean
  reason?: 'expired' | 'rate_limited' | 'mismatch' | 'no_code'
}

export class Pairing {
  private failedAttempts: Map<string, FailedAttempt[]> = new Map()
  private readonly codeTtlMs: number
  private readonly rateLimitWindowMs: number
  private readonly rateLimitMaxAttempts: number

  constructor(opts?: { codeTtlMs?: number; rateLimitWindowMs?: number; rateLimitMaxAttempts?: number }) {
    this.codeTtlMs = opts?.codeTtlMs ?? CODE_TTL_MS
    this.rateLimitWindowMs = opts?.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS
    this.rateLimitMaxAttempts = opts?.rateLimitMaxAttempts ?? RATE_LIMIT_MAX_ATTEMPTS
  }

  /** Generate a new pairing code. */
  generateCode(): { code: string; expiresAt: number; createdAt: number } {
    const code = this.generateSafeCode()
    const now = Date.now()
    return {
      code,
      expiresAt: now + this.codeTtlMs,
      createdAt: now,
    }
  }

  /**
   * Validate a pairing attempt.
   * Returns success if the code matches and is not expired.
   * On failure, records a failed attempt for rate limiting.
   *
   * Note: On success, the caller is responsible for clearing the code
   * and persisting the paired user.
   */
  tryPair(
    messageText: string,
    userId: string,
    config: PairingConfig
  ): PairingResult {
    // Rate limit check
    if (this.isRateLimited(userId)) {
      return { success: false, reason: 'rate_limited' }
    }

    // No code set
    if (!config.pairing.code) {
      return { success: false, reason: 'no_code' }
    }

    // Expired
    if (config.pairing.expiresAt && Date.now() > config.pairing.expiresAt) {
      return { success: false, reason: 'expired' }
    }

    // Mismatch
    const trimmed = messageText.trim().toUpperCase()
    if (trimmed !== config.pairing.code.toUpperCase()) {
      this.recordFailedAttempt(userId)
      return { success: false, reason: 'mismatch' }
    }

    // Success
    return { success: true }
  }

  /** Add a paired user to the config (dedup by userId). */
  addPairedUser(config: PairingConfig, userId: string, displayName?: string): PairedUser {
    const existing = config.pairedUsers.find((u) => u.userId === userId)
    if (existing) {
      return existing
    }

    const user: PairedUser = {
      userId,
      displayName,
      pairedAt: Date.now(),
    }
    config.pairedUsers.push(user)
    return user
  }

  /** Remove a paired user. */
  removePairedUser(config: PairingConfig, userId: string): boolean {
    const idx = config.pairedUsers.findIndex((u) => u.userId === userId)
    if (idx === -1) return false
    config.pairedUsers.splice(idx, 1)
    return true
  }

  /** Check if a user is paired (in pairedUsers or allowedUsers). */
  isPaired(userId: string, config: PairingConfig, allowedUsers?: string[]): boolean {
    // If both lists are empty, default to not paired (security: deny by default)
    if (config.pairedUsers.length === 0 && (!allowedUsers || allowedUsers.length === 0)) {
      return false
    }

    // Check allowedUsers (whitelist)
    if (allowedUsers && allowedUsers.includes(userId)) {
      return true
    }

    // Check pairedUsers
    return config.pairedUsers.some((u) => u.userId === userId)
  }

  /** Clear the pairing code (after successful pairing or expiry). */
  clearCode(config: PairingConfig): void {
    config.pairing.code = null
    config.pairing.expiresAt = null
    config.pairing.createdAt = null
  }

  // ────────────────────────────────────────────────────────────────────────
  // Rate limiting
  // ────────────────────────────────────────────────────────────────────────

  isRateLimited(userId: string): boolean {
    const attempts = this.failedAttempts.get(userId)
    if (!attempts || attempts.length === 0) return false

    const now = Date.now()
    const recent = attempts.filter((a) => now - a.timestamp < this.rateLimitWindowMs)

    if (recent.length >= this.rateLimitMaxAttempts) {
      return true
    }

    return false
  }

  recordFailedAttempt(userId: string): void {
    const attempts = this.failedAttempts.get(userId) ?? []
    attempts.push({ timestamp: Date.now() })
    this.failedAttempts.set(userId, attempts)
  }

  /** Clear failed attempts for a user (e.g., after successful pairing). */
  clearAttempts(userId: string): void {
    this.failedAttempts.delete(userId)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private generateSafeCode(): string {
    const bytes = crypto.randomBytes(CODE_LENGTH)
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length]
    }
    return code
  }
}
