class SpaceCodeVoiceInputProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      const copy = new Float32Array(channel)
      this.port.postMessage(copy.buffer, [copy.buffer])
    }
    return true
  }
}

registerProcessor('spacecode-voice-input', SpaceCodeVoiceInputProcessor)
