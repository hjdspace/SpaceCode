/**
 * Git graph lane assignment — pure functions for topological lane layout.
 *
 * Converts a newest-first commit list (with parent hashes) into per-row lane
 * assignments and edge definitions, ready for SVG rendering by GitGraph.vue.
 */
import type { GitLogEntry } from '@/services/electronAPI'

/** Minimal commit shape required for lane assignment. */
export interface GraphEntry {
  hash: string
  parents?: string[]
}

export interface GraphEdge {
  /** Lane at the top of the row (where the line enters). */
  fromLane: number
  /** Lane at the bottom of the row (where the line exits). */
  toLane: number
  colorIndex: number
}

export interface GraphRow<T extends GraphEntry = GitLogEntry> {
  entry: T
  /** Lane of the commit node itself. */
  nodeLane: number
  colorIndex: number
  edges: GraphEdge[]
  /** Number of active lanes in this row (width of the SVG column). */
  laneCount: number
}

export const GRAPH_COLOR_COUNT = 8

/**
 * Assign lanes to commits. Algorithm (mirrors VSCode git-graph style):
 * - `laneTips[lane]` holds the hash each lane expects to connect to next.
 * - A commit consumes the lane whose tip equals its hash; otherwise it opens
 *   a new lane (new branch head).
 * - First parent inherits the node's free lane when possible; other parents
 *   reuse an existing tip or take a free/new lane.
 */
export function assignLanes<T extends GraphEntry>(entries: T[]): GraphRow<T>[] {
  const laneTips: (string | null)[] = []
  const rows: GraphRow<T>[] = []

  for (const entry of entries) {
    const topLaneCount = laneTips.length

    let nodeLane = laneTips.indexOf(entry.hash)
    if (nodeLane === -1) {
      // New branch head — open a new lane
      nodeLane = laneTips.length
      laneTips.push(null)
    }
    laneTips[nodeLane] = null

    const edges: GraphEdge[] = []
    // Straight pass-through edges for lanes that stay active
    for (let lane = 0; lane < laneTips.length; lane++) {
      if (laneTips[lane]) {
        edges.push({ fromLane: lane, toLane: lane, colorIndex: lane % GRAPH_COLOR_COUNT })
      }
    }

    const parents = entry.parents ?? []
    for (let i = 0; i < parents.length; i++) {
      const parent = parents[i]!
      let parentLane = laneTips.indexOf(parent)
      if (parentLane === -1) {
        if (i === 0 && laneTips[nodeLane] === null) {
          // First parent inherits the node's just-freed lane
          parentLane = nodeLane
        } else {
          const freeLane = laneTips.indexOf(null)
          parentLane = freeLane === -1 ? laneTips.length : freeLane
          if (parentLane === laneTips.length) laneTips.push(null)
        }
        laneTips[parentLane] = parent
      }
      edges.push({ fromLane: nodeLane, toLane: parentLane, colorIndex: parentLane % GRAPH_COLOR_COUNT })
    }

    rows.push({
      entry,
      nodeLane,
      colorIndex: nodeLane % GRAPH_COLOR_COUNT,
      edges,
      laneCount: Math.max(topLaneCount, laneTips.length),
    })
  }

  return rows
}
