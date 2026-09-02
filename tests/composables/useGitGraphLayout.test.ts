/**
 * Tests for git graph lane assignment (src/composables/useGitGraphLayout.ts).
 */
import { describe, it, expect } from 'vitest'
import { assignLanes, GRAPH_COLOR_COUNT } from '@/composables/useGitGraphLayout'
import type { GitLogEntry } from '@/services/electronAPI'

function entry(hash: string, parents: string[], refs = ''): GitLogEntry {
  return { hash, shortHash: hash.slice(0, 7), subject: `commit ${hash}`, message: `commit ${hash}`, author: 'a', date: '2026-01-01', refs, parents }
}

describe('assignLanes', () => {
  it('assigns lane 0 to a linear history', () => {
    const rows = assignLanes([entry('c3', ['c2']), entry('c2', ['c1']), entry('c1', [])])
    expect(rows.map(r => r.nodeLane)).toEqual([0, 0, 0])
    expect(rows.every(r => r.laneCount === 1)).toBe(true)
    // All edges stay in lane 0
    for (const row of rows) {
      expect(row.edges.every(e => e.fromLane === 0 && e.toLane === 0)).toBe(true)
    }
  })

  it('opens a new lane for a feature branch', () => {
    // feature: c1 <- c2 <- c3 ; main: c1 <- c4
    const rows = assignLanes([
      entry('c3', ['c2']),
      entry('c2', ['c1']),
      entry('c4', ['c1']), // main head appears after feature commits
      entry('c1', []),
    ])
    // c3 opens lane 0; c2 consumes lane 0 (first-parent inheritance);
    // c4 is a new head → lane 1; c1 consumes lane 0.
    expect(rows[0]!.nodeLane).toBe(0)
    expect(rows[1]!.nodeLane).toBe(0)
    expect(rows[2]!.nodeLane).toBe(1)
    expect(rows[3]!.nodeLane).toBe(0)
    // c4's edge curves to parent c1 which sits in lane 0
    const c4Row = rows[2]!
    expect(c4Row.edges.some(e => e.fromLane === 1 && e.toLane === 0)).toBe(true)
  })

  it('routes a merge commit edge from node lane to first parent lane', () => {
    // c2 and c3 both children of c1; c4 merges c2 and c3
    const rows = assignLanes([
      entry('c4', ['c2', 'c3'], 'HEAD'),
      entry('c3', ['c1']),
      entry('c2', ['c1']),
      entry('c1', []),
    ])
    const mergeRow = rows[0]!
    expect(mergeRow.nodeLane).toBe(0)
    expect(mergeRow.entry.parents).toEqual(['c2', 'c3'])
    // Two parent edges from node lane
    expect(mergeRow.edges.filter(e => e.fromLane === 0).length).toBeGreaterThanOrEqual(2)
    // First parent edge targets node's own lane (inheritance)
    const firstParentEdge = mergeRow.edges.find(e => e.fromLane === 0)!
    expect(firstParentEdge.toLane).toBe(0)
  })

  it('handles root commits with no parents', () => {
    const rows = assignLanes([entry('c1', [])])
    expect(rows[0]!.nodeLane).toBe(0)
    expect(rows[0]!.edges).toEqual([])
    expect(rows[0]!.laneCount).toBe(1)
  })

  it('handles missing parents field gracefully', () => {
    const e = entry('c1', [])
    delete (e as Record<string, unknown>).parents
    const rows = assignLanes([e])
    expect(rows[0]!.edges).toEqual([])
  })

  it('cycles colors with modulo', () => {
    const entries: GitLogEntry[] = []
    for (let i = 0; i < GRAPH_COLOR_COUNT * 2; i++) {
      entries.push(entry(`h${i}`, []))
    }
    const rows = assignLanes(entries)
    expect(rows[GRAPH_COLOR_COUNT]!.colorIndex).toBe(0)
  })

  it('returns empty array for empty input', () => {
    expect(assignLanes([])).toEqual([])
  })
})
