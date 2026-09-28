/**
 * Tests for work assistant icon/category/display-name helpers.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { Bot, Presentation } from 'lucide-vue-next'
import {
  WORK_CATEGORY_COLORS,
  workAssistantIcon,
  workAvatarStyle,
  workCategoryColor,
  workDisplayName,
} from '../../src/utils/workAssistant.ts'

describe('workAssistantIcon', () => {
  it('maps a known avatar name to its component', () => {
    assert.equal(workAssistantIcon('presentation'), Presentation)
  })

  it('falls back to Bot for unknown names', () => {
    assert.equal(workAssistantIcon('does-not-exist'), Bot)
  })

  it('falls back to Bot when avatar is missing', () => {
    assert.equal(workAssistantIcon(), Bot)
    assert.equal(workAssistantIcon(''), Bot)
  })
})

describe('workCategoryColor', () => {
  it('returns the color for a known category', () => {
    assert.equal(workCategoryColor('office'), '#3b82f6')
  })

  it('falls back to general for unknown or missing categories', () => {
    assert.equal(workCategoryColor('nope'), WORK_CATEGORY_COLORS.general)
    assert.equal(workCategoryColor(), WORK_CATEGORY_COLORS.general)
  })
})

describe('workAvatarStyle', () => {
  it('derives foreground color and 12% alpha background from the category', () => {
    const style = workAvatarStyle('office')
    assert.equal(style.color, '#3b82f6')
    assert.equal(style.background, 'rgba(59, 130, 246, 0.12)')
  })

  it('uses the general category when none is given', () => {
    const style = workAvatarStyle()
    assert.equal(style.color, WORK_CATEGORY_COLORS.general)
    assert.match(style.background, /^rgba\(\d+, \d+, \d+, 0\.12\)$/)
  })
})

describe('workDisplayName', () => {
  it('title-cases kebab-case words', () => {
    assert.equal(workDisplayName('weekly-report'), 'Weekly Report')
  })

  it('keeps known acronyms uppercase', () => {
    assert.equal(workDisplayName('ppt-ui-designer'), 'PPT UI Designer')
    assert.equal(workDisplayName('3d-ai-api-sql-pdf'), '3D AI API SQL PDF')
  })

  it('handles a single word', () => {
    assert.equal(workDisplayName('assistant'), 'Assistant')
  })
})
