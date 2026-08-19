/**
 * Notification sound utility — plays a short pleasant chime when a chat task completes.
 *
 * Uses the Web Audio API to synthesize a two-tone ascending chime without needing
 * any external audio asset files. This keeps the bundle small and works across
 * Electron + browser environments.
 */

let _audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_audioCtx) return _audioCtx
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return null
    _audioCtx = new Ctor()
    return _audioCtx
  } catch {
    return null
  }
}

/**
 * Play a short ascending two-tone chime (E5 → A5) to signal task completion.
 *
 * The sound is deliberately subtle (~0.35s total) so it notifies without
 * being intrusive. If the AudioContext is suspended (common in Electron
 * before a user gesture), we attempt to resume it first.
 */
export function playTaskCompleteSound(): void {
  const ctx = getAudioContext()
  if (!ctx) return

  // Resume if suspended (Electron may start in suspended state)
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const masterGain = ctx.createGain()
  masterGain.gain.value = 0.15
  masterGain.connect(ctx.destination)

  // Tone 1: E5 (659.25 Hz) — 0.00s to 0.15s
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

  // Tone 2: A5 (880.00 Hz) — 0.12s to 0.35s
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
}
