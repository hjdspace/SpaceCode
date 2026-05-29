export interface SSEEvent {
  event: string | null
  data: string
  id?: string
  retry?: number
}

export class SSEParser {
  private buffer = ''

  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk
    const events: SSEEvent[] = []

    while (true) {
      const eventEnd = this.buffer.indexOf('\n\n')
      if (eventEnd === -1) break

      const rawEvent = this.buffer.slice(0, eventEnd)
      this.buffer = this.buffer.slice(eventEnd + 2)

      const event = this.parseSingleEvent(rawEvent)
      if (event) events.push(event)
    }

    return events
  }

  reset(): void {
    this.buffer = ''
  }

  private parseSingleEvent(raw: string): SSEEvent | null {
    let event: string | null = null
    let data = ''
    let id: string | undefined
    let retry: number | undefined

    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim()
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim()
      } else if (line.startsWith('retry:')) {
        const val = parseInt(line.slice(6).trim(), 10)
        if (!isNaN(val)) retry = val
      }
    }

    if (!data) return null
    if (data === '[DONE]') return { event: 'done', data: '[DONE]' }

    const result: SSEEvent = { event, data }
    if (id !== undefined) result.id = id
    if (retry !== undefined) result.retry = retry
    return result
  }
}
