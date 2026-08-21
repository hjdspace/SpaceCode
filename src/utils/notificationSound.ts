/**
 * Notification sound utility — plays a short pleasant chime when a chat task completes.
 *
 * Two strategies are used for maximum compatibility in Electron:
 *
 * 1. **Primary: HTMLAudioElement + WAV data URI** — not subject to AudioContext
 *    autoplay restrictions. Works reliably in Electron renderer.
 * 2. **Fallback: Web Audio API** — used if the WAV approach fails.
 */

/**
 * A minimal WAV file (base64) containing a short two-tone ascending chime
 * (E5 659Hz → A5 880Hz, ~0.3s). Generated programmatically so no asset
 * file is needed.
 */
function buildChimeWavBase64(): string {
  const sampleRate = 44100
  const duration = 0.35 // seconds
  const samples = Math.floor(sampleRate * duration)
  const numChannels = 1
  const bitsPerSample = 16
  const dataSize = samples * numChannels * (bitsPerSample / 8)
  const fileSize = 44 + dataSize

  // Build WAV buffer
  const buf = new ArrayBuffer(fileSize)
  const view = new DataView(buf)

  // RIFF header
  view.setUint32(0, 0x52494646, false)     // "RIFF"
  view.setUint32(4, fileSize - 8, true)     // file size - 8
  view.setUint32(8, 0x57415645, false)     // "WAVE"

  // fmt subchunk
  view.setUint32(12, 0x666d7420, false)    // "fmt "
  view.setUint32(16, 16, true)             // subchunk size
  view.setUint16(20, 1, true)              // audio format (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true) // byte rate
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)              // block align
  view.setUint16(34, bitsPerSample, true)

  // data subchunk
  view.setUint32(36, 0x64617461, false)    // "data"
  view.setUint32(40, dataSize, true)

  // Audio data: two-tone chime
  // Tone 1: E5 (659.25 Hz) from 0.00s to 0.15s
  // Tone 2: A5 (880.00 Hz) from 0.12s to 0.35s
  // Master volume: 0.15
  const masterVolume = 0.15
  let offset = 44
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate
    let sample = 0

    // Tone 1: E5, envelope 0→0.15s
    if (t < 0.15) {
      const env1 = Math.exp(-t * 20) // exponential decay
      sample += Math.sin(2 * Math.PI * 659.25 * t) * env1
    }

    // Tone 2: A5, envelope 0.12→0.35s
    if (t >= 0.12) {
      const t2 = t - 0.12
      const env2 = Math.exp(-t2 * 15)
      sample += Math.sin(2 * Math.PI * 880.00 * t2) * env2
    }

    // Clamp and scale
    const clamped = Math.max(-1, Math.min(1, sample * masterVolume))
    view.setInt16(offset, clamped * 32767, true)
    offset += 2
  }

  // Convert to base64
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

let _cachedDataUri: string | null = null

function getChimeDataUri(): string {
  if (_cachedDataUri) return _cachedDataUri
  try {
    _cachedDataUri = 'data:audio/wav;base64,' + buildChimeWavBase64()
  } catch {
    // btoa might fail in edge cases; return empty to signal failure
    _cachedDataUri = ''
  }
  return _cachedDataUri
}

/**
 * Play a short ascending two-tone chime (E5 → A5) to signal task completion.
 *
 * Uses HTMLAudioElement with a generated WAV data URI for reliable playback
 * in Electron environments where Web Audio API AudioContext may be suspended.
 */
export function playTaskCompleteSound(): void {
  if (typeof window === 'undefined') return

  const dataUri = getChimeDataUri()
  if (!dataUri) {
    console.warn('[NotificationSound] Failed to build chime WAV data URI')
    return
  }

  try {
    const audio = new Audio(dataUri)
    audio.volume = 0.3
    // Play and clean up
    const playPromise = audio.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          // Playback started successfully
        })
        .catch((err) => {
          console.warn('[NotificationSound] HTMLAudioElement play failed, trying Web Audio fallback', { error: String(err) })
          webAudioFallback()
        })
    }
    // Clean up after playback ends
    audio.addEventListener('ended', () => {
      audio.src = ''
    }, { once: true })
  } catch (err) {
    console.warn('[NotificationSound] Failed to create Audio element, trying Web Audio fallback', { error: String(err) })
    webAudioFallback()
  }
}

/**
 * Fallback: use Web Audio API to synthesize the chime.
 * Creates a fresh AudioContext each time to avoid suspended-state issues.
 */
function webAudioFallback(): void {
  if (typeof window === 'undefined') return
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const now = ctx.currentTime
    const masterGain = ctx.createGain()
    masterGain.gain.value = 0.15
    masterGain.connect(ctx.destination)

    // Tone 1: E5 (659.25 Hz)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.value = 659.25
    gain1.gain.setValueAtTime(0, now)
    gain1.gain.linearRampToValueAtTime(1, now + 0.02)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    osc1.connect(gain1)
    gain1.connect(masterGain)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Tone 2: A5 (880.00 Hz)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.value = 880.00
    gain2.gain.setValueAtTime(0, now + 0.12)
    gain2.gain.linearRampToValueAtTime(1, now + 0.14)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    osc2.connect(gain2)
    gain2.connect(masterGain)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.35)

    // Close context after playback
    setTimeout(() => {
      void ctx.close().catch(() => {})
    }, 500)
  } catch (err) {
    console.warn('[NotificationSound] Web Audio fallback also failed', { error: String(err) })
  }
}
