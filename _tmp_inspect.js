// Print every file-history-snapshot entry from the most recently modified session in SpaceCode
const fs = require('fs')
const path = require('path')

const dir = path.join(process.env.USERPROFILE, '.claude', 'projects', 'D--AI-SpaceCode')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))

// sort by mtime
const stat = files.map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
stat.sort((a, b) => b.mtime - a.mtime)

// Look at the 5 most recent
for (const { f } of stat.slice(0, 8)) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8')
  const lines = content.split('\n').filter(Boolean)
  const snapshots = []
  let editToolCount = 0
  for (const line of lines) {
    let m
    try { m = JSON.parse(line) } catch { continue }
    if (m.type === 'file-history-snapshot') snapshots.push(m)
    else if (m.type === 'assistant') {
      const blocks = m.message?.content
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b.type === 'tool_use' && /^(Edit|Write|MultiEdit|FileWrite|FileEdit|NotebookEdit)$/.test(b.name)) editToolCount++
        }
      }
    }
  }
  console.log(`\n=== ${f} (lines=${lines.length}, editTools=${editToolCount}, snapshots=${snapshots.length}) ===`)
  for (const s of snapshots.slice(0, 4)) {
    console.log(JSON.stringify({
      messageId: s.messageId,
      isSnapshotUpdate: s.isSnapshotUpdate,
      snapshotMessageId: s.snapshot?.messageId,
      backupCount: Object.keys(s.snapshot?.trackedFileBackups || {}).length,
      backupSample: Object.entries(s.snapshot?.trackedFileBackups || {}).slice(0, 2),
    }, null, 2))
  }
}
