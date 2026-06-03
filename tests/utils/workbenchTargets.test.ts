/**
 * Tests for workbench-link detection and selection-message composition.
 * Run with:
 *   node --experimental-strip-types --test tests/utils/workbenchTargets.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectWorkbenchTargets } from '../../src/utils/workbench-targets.ts'
import { buildSelectionMessage, type InspectorSelection } from '../../src/utils/webviewInspector.ts'

describe('detectWorkbenchTargets', () => {
  it('detects a localhost url', () => {
    const targets = detectWorkbenchTargets('启动成功, 访问 http://localhost:5173 查看')
    assert.equal(targets.length, 1)
    assert.equal(targets[0].kind, 'url')
    assert.equal(targets[0].value, 'http://localhost:5173')
  })

  it('strips trailing punctuation from urls', () => {
    const targets = detectWorkbenchTargets('打开 http://127.0.0.1:3000/page.')
    assert.equal(targets[0].value, 'http://127.0.0.1:3000/page')
  })

  it('detects local html and markdown file paths', () => {
    const targets = detectWorkbenchTargets('见 ./dist/index.html 和 /tmp/report.md')
    const vals = targets.map(t => t.value)
    assert.ok(vals.includes('./dist/index.html'))
    assert.ok(vals.includes('/tmp/report.md'))
    assert.ok(targets.every(t => t.kind === 'file'))
  })

  it('deduplicates repeated targets', () => {
    const targets = detectWorkbenchTargets('http://localhost:5173 then again http://localhost:5173')
    assert.equal(targets.length, 1)
  })

  it('ignores plain code files (non html/md)', () => {
    const targets = detectWorkbenchTargets('编辑了 src/main.ts 文件')
    assert.equal(targets.length, 0)
  })

  it('returns empty for blank content', () => {
    assert.deepEqual(detectWorkbenchTargets(''), [])
  })
})

describe('buildSelectionMessage', () => {
  const sel: InspectorSelection = {
    selector: 'body > div.app > h1',
    tagName: 'h1',
    idClass: '.title',
    rect: { x: 10, y: 20, width: 468, height: 46 },
    styles: {
      color: 'rgb(0, 0, 0)',
      font: '32px sans-serif',
      fontSize: '32px',
      fontFamily: 'sans-serif',
      backgroundColor: 'rgba(0,0,0,0)',
    },
    textSnippet: 'Todo',
    outerHTMLSnippet: '<h1 class="title">Todo</h1>',
    pageUrl: 'http://localhost:5173/',
    devicePixelRatio: 2,
  }

  it('embeds element identity, dimensions and the user comment', () => {
    const msg = buildSelectionMessage(sel, '把标题改成蓝色')
    assert.match(msg, /<h1\.title>/)
    assert.match(msg, /468×46/)
    assert.match(msg, /body > div\.app > h1/)
    assert.match(msg, /把标题改成蓝色/)
    assert.match(msg, /http:\/\/localhost:5173\//)
  })

  it('falls back when comment is empty', () => {
    const msg = buildSelectionMessage(sel, '   ')
    assert.match(msg, /\(见附图\)/)
  })
})
