// tests/components/orchestrationEdge.test.ts
// 编排连线（自定义 Edge）测试 — 视觉状态推导、渲染层着色与流动动效的存在性。

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Position } from '@vue-flow/core'
import OrchestrationEdge from '@/components/orchestration/OrchestrationEdge.vue'
import {
  EDGE_STATE_COLORS,
  ORCHESTRATION_EDGE_TYPE,
  hasFlowOverlay,
  toEdgeVisualState,
  toFlowEdge,
  type EdgeVisualState,
} from '@/components/orchestration/edgeVisuals'

function mountEdge(state?: EdgeVisualState) {
  return mount(OrchestrationEdge, {
    props: {
      id: 'edge-a-b',
      sourceX: 0,
      sourceY: 0,
      targetX: 240,
      targetY: 40,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      markerEnd: "url('#arrow')",
      interactionWidth: 20,
      data: { state },
    },
  })
}

describe('编排连线 — 视觉状态推导', () => {
  it.each([
    ['running', 'active'],
    ['settled', 'done'],
    ['failed', 'blocked'],
    ['skipped', 'blocked'],
    ['pending', 'idle'],
    ['queued', 'idle'],
    ['interrupted', 'idle'],
  ] as const)('上游节点 %s → 连线 %s', (status, expected) => {
    expect(toEdgeVisualState(status)).toBe(expected)
  })

  it('上游无状态（未运行过）视为 idle', () => {
    expect(toEdgeVisualState(undefined)).toBe('idle')
  })

  it('仅 idle / active 叠加流动高亮层', () => {
    expect(hasFlowOverlay('idle')).toBe(true)
    expect(hasFlowOverlay('active')).toBe(true)
    expect(hasFlowOverlay('done')).toBe(false)
    expect(hasFlowOverlay('blocked')).toBe(false)
  })
})

describe('编排连线 — 渲染用 Edge 定义', () => {
  it('使用自定义连线类型并按状态给箭头着色', () => {
    const edge = toFlowEdge({ id: 'e1', source: 'A', target: 'B' }, 'active')

    expect(edge.type).toBe(ORCHESTRATION_EDGE_TYPE)
    expect(edge.data).toEqual({ state: 'active' })
    expect(edge.markerEnd).toMatchObject({
      color: EDGE_STATE_COLORS.active,
    })
  })
})

describe('编排连线 — 渲染', () => {
  it('基础线走真实贝塞尔路径并带箭头', () => {
    const wrapper = mountEdge('idle')
    const base = wrapper.get('.orch-edge__base')

    expect(base.attributes('d')).toContain('C')
    expect(base.attributes('marker-end')).toBe("url('#arrow')")
    expect(base.attributes('stroke')).toBe('currentColor')
  })

  it.each([
    ['idle', true],
    ['active', true],
    ['done', false],
    ['blocked', false],
  ] as const)('%s 状态下的流动高亮层存在性为 %s', (state, expected) => {
    expect(mountEdge(state).find('.orch-edge__flow').exists()).toBe(expected)
  })

  it('上游运行中才有流动光点，且光点沿同一路径运动', () => {
    const active = mountEdge('active')
    const packet = active.get('.orch-edge__packet')
    const motion = packet.element.firstElementChild

    expect(motion?.tagName.toLowerCase()).toBe('animatemotion')
    expect(motion?.getAttribute('path')).toBe(active.get('.orch-edge__base').attributes('d'))
    expect(motion?.getAttribute('repeatCount')).toBe('indefinite')

    expect(mountEdge('done').find('.orch-edge__packet').exists()).toBe(false)
  })

  it('状态落到根节点类名上，驱动配色与虚线区分', () => {
    expect(mountEdge('blocked').get('g').classes()).toContain('is-blocked')
    expect(mountEdge('done').get('g').classes()).toContain('is-done')
  })

  it('未传状态时退化为 idle 配色', () => {
    const wrapper = mountEdge(undefined)
    expect(wrapper.get('g').classes()).toContain('is-idle')
    expect(wrapper.get('g').attributes('style')).toContain('color')
  })
})
