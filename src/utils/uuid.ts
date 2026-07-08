function fallbackRandomUUID(): string {
  const bytes = new Uint8Array(16)
  const cryptoLike = typeof globalThis !== 'undefined'
    ? (globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined)
    : undefined

  if (typeof cryptoLike?.getRandomValues === 'function') {
    cryptoLike.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

export function createUuid(): string {
  const cryptoLike = typeof globalThis !== 'undefined'
    ? (globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined)
    : undefined
  const nativeRandomUUID = cryptoLike?.randomUUID

  if (typeof nativeRandomUUID === 'function') {
    return nativeRandomUUID.call(cryptoLike)
  }

  return fallbackRandomUUID()
}

export function installRandomUUIDFallback(): void {
  if (typeof globalThis === 'undefined') return

  const cryptoLike = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined
  if (!cryptoLike) {
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: fallbackRandomUUID },
        configurable: true,
      })
    } catch {
      // Best effort only; critical H5 paths call createUuid directly.
    }
    return
  }

  if (typeof cryptoLike.randomUUID === 'function') return

  try {
    Object.defineProperty(cryptoLike, 'randomUUID', {
      value: fallbackRandomUUID,
      configurable: true,
    })
  } catch {
    // Best effort only; critical H5 paths call createUuid directly.
  }
}
