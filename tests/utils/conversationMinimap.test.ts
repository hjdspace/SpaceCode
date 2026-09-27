/**
 * Tests for conversation minimap marker building and visibility rules.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS,
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
} from '../../src/utils/conversation-minimap.ts'
import type { Message } from '../../src/types/index.ts'

function msg(role: string, id: string, content = ''): Message {
  return { id, role, content } as unknown as Message
}

describe('shouldRenderConversationMinimap', () => {
  it('renders when there is earlier history regardless of overflow', () => {
    assert.equal(
      shouldRenderConversationMinimap({ markerCount: 0, overflows: false, hasEarlier: true }),
      true,
    )
  })

  it('renders when at least 2 markers and content overflows', () => {
    assert.equal(
      shouldRenderConversationMinimap({ markerCount: 2, overflows: true, hasEarlier: false }),
      true,
    )
  })

  it('does not render with fewer than 2 markers even when overflowing', () => {
    assert.equal(
      shouldRenderConversationMinimap({ markerCount: 1, overflows: true, hasEarlier: false }),
      false,
    )
  })

  it('does not render without overflow or earlier history', () => {
    assert.equal(
      shouldRenderConversationMinimap({ markerCount: 5, overflows: false, hasEarlier: false }),
      false,
    )
  })
})

describe('buildConversationMinimapMarkers', () => {
  it('builds one user and one assistant marker per turn', () => {
    const markers = buildConversationMinimapMarkers([
      msg('user', 'u1', '问题一'),
      msg('assistant', 'a1', '回答一'),
      msg('user', 'u2', '问题二'),
      msg('assistant', 'a2', '回答二'),
    ])
    assert.equal(markers.length, 4)
    assert.deepEqual(
      markers.map(m => [m.id, m.role]),
      [['u1', 'user'], ['a1', 'assistant'], ['u2', 'user'], ['a2', 'assistant']],
    )
  })

  it('merges consecutive assistant messages into a single marker', () => {
    const markers = buildConversationMinimapMarkers([
      msg('user', 'u1', '问题'),
      msg('assistant', 'a1', '第一段'),
      msg('assistant', 'a2', '第二段'),
    ])
    assert.equal(markers.length, 2)
    assert.equal(markers[1].id, 'a1')
    assert.equal(markers[1].preview, '第一段\n\n第二段')
  })

  it('skips assistant messages with empty content', () => {
    const markers = buildConversationMinimapMarkers([
      msg('user', 'u1', '问题'),
      msg('assistant', 'a1', '   '),
      msg('assistant', 'a2', '有效回复'),
    ])
    assert.equal(markers.length, 2)
    assert.equal(markers[1].id, 'a2')
  })

  it('ignores non-user non-assistant roles', () => {
    const markers = buildConversationMinimapMarkers([
      msg('system', 's1', '系统提示'),
      msg('user', 'u1', '问题'),
    ])
    assert.equal(markers.length, 1)
    assert.equal(markers[0].role, 'user')
  })

  it('trims user content and truncates to the preview limit', () => {
    const long = 'x'.repeat(CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS + 50)
    const markers = buildConversationMinimapMarkers([msg('user', 'u1', `  ${long}  `)])
    assert.equal(markers[0].preview.length, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS)
  })

  it('caps merged assistant preview at the max chars', () => {
    const part = 'y'.repeat(CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS - 10)
    const markers = buildConversationMinimapMarkers([
      msg('assistant', 'a1', part),
      msg('assistant', 'a2', 'z'.repeat(100)),
    ])
    assert.equal(markers.length, 1)
    assert.ok(markers[0].preview.length <= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS)
  })

  it('does not append when the merged preview already reached the limit', () => {
    const full = 'y'.repeat(CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS)
    const markers = buildConversationMinimapMarkers([
      msg('assistant', 'a1', full),
      msg('assistant', 'a2', '额外内容'),
    ])
    assert.equal(markers[0].preview, full)
  })

  it('handles missing content gracefully', () => {
    const markers = buildConversationMinimapMarkers([
      { id: 'u1', role: 'user' } as unknown as Message,
    ])
    assert.equal(markers.length, 1)
    assert.equal(markers[0].preview, '')
  })

  it('returns empty for no messages', () => {
    assert.deepEqual(buildConversationMinimapMarkers([]), [])
  })
})
