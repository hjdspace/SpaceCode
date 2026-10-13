// electron/h5/h5ConfigRedactor.ts
// 外发桌面 GUI 设置前的凭据剥离 — 「读设置」不应等于「读密钥」

const SECRET_FIELD =
  /api[-_]?key|access[-_]?key|auth[-_]?token|secret|token|password|passwd|credential|private[-_]?key|bearer|authorization/i

const MAX_DEPTH = 8

function redact(value: unknown, depth: number): unknown {
  // Deeper than the settings schema ever goes: drop rather than risk a miss.
  if (depth >= MAX_DEPTH) return null

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD.test(key)) continue
      out[key] = redact(item, depth + 1)
    }
    return out
  }

  return value
}

/**
 * Re-serialise a JSON document with every credential-looking field removed.
 * Returns null for anything that cannot be parsed — an uninspectable document
 * is never forwarded.
 */
export function redactSecretsInJson(raw: string): string | null {
  try {
    return JSON.stringify(redact(JSON.parse(raw), 0))
  } catch {
    return null
  }
}
