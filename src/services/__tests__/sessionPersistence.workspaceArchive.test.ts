import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadArchivedWorkspacesFromStorage,
  saveArchivedWorkspacesToStorage,
} from '../sessionPersistence'

beforeEach(() => localStorage.clear())

describe('archived workspaces persistence', () => {
  it('round-trips the map', () => {
    expect(saveArchivedWorkspacesToStorage({ 'D:\\AI\\SpaceCode': 1000 })).toBe(true)
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\AI\\SpaceCode': 1000 })
  })

  it('normalizes separators and dedupes case-insensitively on load', () => {
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify({
      'D:\\\\AI\\\\SpaceCode': 1000,
      'd:/ai/spacecode': 2000,
    }))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\AI\\SpaceCode': 1000 })
  })

  it('drops invalid entries', () => {
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify({
      'D:/ok': 5,
      'D:/bad': 'nope',
      '': 9,
    }))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\ok': 5 })
  })

  it('survives bad JSON and non-object payloads', () => {
    localStorage.setItem('chat_archived_workspaces_v1', '{bad json')
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify([1, 2]))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
    localStorage.removeItem('chat_archived_workspaces_v1')
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
  })
})