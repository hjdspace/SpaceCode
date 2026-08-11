// electron/petWindowManager.ts
// 桌面宠物窗口控制器。参考 cc-haha 的 PetWindowController 重写：
// 主进程驱动的光标采样拖拽、面板贴边翻转（带滞回）、区域穿透（setShape/setIgnoreMouseEvents）、
// 位置持久化（写入 PetConfig.windowState）。
import {
  BrowserWindow,
  Menu,
  screen,
  type Rectangle,
  type Point,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { join } from 'path'
import { info, warn } from './logger'
import type {
  PetConfig,
  PetMainWindowEvent,
  PetPreferences,
  PetSyncPayload,
  PetInteractiveRegion,
} from '../src/types/pet'

// ── 常量（对齐 cc-haha） ──

/** 宠物窗口宽度（包含 mascot 周围透明 padding，让 mascot 能贴屏幕边缘） */
const PET_WINDOW_WIDTH = 384
/** 宠物窗口高度（同上） */
const PET_WINDOW_HEIGHT = 400
/** 默认贴边 margin */
const PET_WINDOW_MARGIN = 24
/** 拖拽光标采样间隔（约 60fps） */
const PET_WINDOW_DRAG_INTERVAL_MS = 16
/** setShape 区域外扩 padding（Windows/Linux 穿透用，让 mascot 边缘也可点） */
const PET_WINDOW_SHAPE_PADDING = 12
/** 面板与 mascot 之间的间隙 */
const PET_PANEL_GAP = 12
/** 面板翻转滞回，避免抖动：翻转本身会移动窗口，裸 fit 测试会立刻翻回 */
const PET_PANEL_FLIP_HYSTERESIS = 24

type PanelPlacement = 'above' | 'below'
const DEFAULT_PLACEMENT: PanelPlacement = 'above'

type Position = Pick<Point, 'x' | 'y'>

interface DragState {
  window: BrowserWindow
  pointerStart: Position
  windowStart: Position
  lastPosition: Position
}

// ── 类型守卫 ──

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isFiniteCoordinate(record.x) && isFiniteCoordinate(record.y)
}

// ── 几何工具 ──

/**
 * 夹紧窗口位置，让 visibleRegion（通常是 mascot 区域）能贴屏幕边缘
 * 而非整个窗口贴边（窗口周围有透明 padding）。
 */
function clampPetWindowPosition(
  position: Position,
  workArea: Rectangle,
  visibleRegion: Rectangle = { x: 0, y: 0, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT },
): Position {
  const minX = workArea.x - visibleRegion.x
  const minY = workArea.y - visibleRegion.y
  const maxX = minX + Math.max(0, workArea.width - visibleRegion.width)
  const maxY = minY + Math.max(0, workArea.height - visibleRegion.height)
  return {
    x: Math.min(Math.max(Math.round(position.x), minX), maxX),
    y: Math.min(Math.max(Math.round(position.y), minY), maxY),
  }
}

/**
 * 计算面板（mascot 之外的所有附件区域）的包围盒。
 * regions[0] 是 mascot 本身（拖拽锚点），其后的是面板附件（活动卡片、角标等）。
 */
function petPanelBounds(regions: Rectangle[]): Rectangle | null {
  const attachments = regions.slice(1)
  if (attachments.length === 0) return null
  const left = Math.min(...attachments.map((r) => r.x))
  const top = Math.min(...attachments.map((r) => r.y))
  const right = Math.max(...attachments.map((r) => r.x + r.width))
  const bottom = Math.max(...attachments.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * 根据窗口位置和工作区决定面板在 mascot 上方还是下方。
 * 测量刻意与当前 placement 无关：面板高度两侧相同，mascot 屏幕位置在翻转中保持，
 * 所以两侧比较都能存活翻转。带 24px 滞回避免抖动。
 */
function resolvePanelPlacement(params: {
  windowPosition: Position
  workArea: Rectangle
  mascot: Rectangle
  panel: Rectangle | null
  previous: PanelPlacement
}): PanelPlacement {
  const { windowPosition, workArea, mascot, panel, previous } = params
  if (!panel) return DEFAULT_PLACEMENT
  const required = panel.height + PET_PANEL_GAP
  const spaceAbove = windowPosition.y + mascot.y - workArea.y
  const threshold = previous === 'above' ? required : required + PET_PANEL_FLIP_HYSTERESIS
  return spaceAbove >= threshold ? 'above' : 'below'
}

/**
 * 用 setPosition 会因 DIP 往返在 Windows 缩放显示上逐帧增大窗口，
 * 改用 setBounds 重申名义尺寸是幂等的（窗口创建时固定尺寸，重复应用还能修正漂移）。
 */
function movePetWindow(window: BrowserWindow, position: Position): void {
  window.setBounds({
    x: position.x,
    y: position.y,
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
  })
}

/** getContentBounds 在内容视图分离时返回空 rect，回退到窗口 bounds */
function petWindowContentExtent(window: BrowserWindow): { width: number; height: number } {
  const candidates = [window.getContentBounds?.(), window.getBounds()]
  const measured = candidates.find((c): c is Rectangle => !!c && c.width > 0 && c.height > 0)
  return {
    width: measured ? Math.round(measured.width) : PET_WINDOW_WIDTH,
    height: measured ? Math.round(measured.height) : PET_WINDOW_HEIGHT,
  }
}

/** 将渲染进程报告的区域夹到实际内容盒内 */
function normalizeRegion(
  region: Rectangle,
  extent: { width: number; height: number },
): Rectangle {
  const x = Math.max(0, Math.min(extent.width - 1, Math.round(region.x)))
  const y = Math.max(0, Math.min(extent.height - 1, Math.round(region.y)))
  const right = Math.max(x + 1, Math.min(extent.width, Math.round(region.x + region.width)))
  const bottom = Math.max(y + 1, Math.min(extent.height, Math.round(region.y + region.height)))
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * 计算窗口初始 bounds。如果有恢复的位置且已初始化（x !== -1），按整窗口夹紧；
 * 否则放在主屏工作区右下角。
 * 注：精确的 mascot 贴边夹紧等渲染进程报告 region 后由 setInteractiveRegions 处理。
 */
function getInitialBounds(workArea: Rectangle, restored: PetConfig['windowState']): Rectangle {
  if (restored.x !== -1 && restored.y !== -1) {
    return {
      ...clampPetWindowPosition({ x: restored.x, y: restored.y }, workArea),
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
    }
  }
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN),
    y: Math.max(workArea.y, workArea.y + workArea.height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN),
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
  }
}

function buildWindowOptions(bounds: Rectangle, preload: string): BrowserWindowConstructorOptions {
  const platform = process.platform
  return {
    ...bounds,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    // macOS 会用 constrainFrameRect 把 y 夹回工作区顶部，而 mascot 贴顶需要负 y，
    // 所以 macOS 开 enableLargerThanScreen；其它平台用 skipTaskbar 隐藏任务栏图标。
    ...(platform === 'darwin'
      ? { enableLargerThanScreen: true }
      : { skipTaskbar: true }),
    transparent: true,
    type: platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}

// ── PetWindowController ──

export interface PetWindowControllerOptions {
  /** petPreload.js 绝对路径 */
  preloadPath: string
  /** 是否开发模式（决定加载 URL 还是本地文件） */
  isDev: boolean
}

export class PetWindowController {
  private window: BrowserWindow | null = null
  private config: PetConfig | null = null
  private drag: DragState | null = null
  private dragTimer: ReturnType<typeof setInterval> | null = null
  /** 渲染进程报告的 mascot 区域（拖拽夹紧锚点） */
  private visibleDragRegion: Rectangle | null = null
  /** 面板附件包围盒（翻转判定用） */
  private panelBounds: Rectangle | null = null
  private panelPlacement: PanelPlacement = DEFAULT_PLACEMENT
  /**
   * mascot 需要保持的屏幕 y。翻转/恢复时 mascot 在窗口内位置会变，
   * 主进程据此反向移动窗口让 mascot 屏幕坐标不动。等渲染进程报告下一次布局时消费。
   */
  private pendingMascotAnchorScreenY: number | null = null
  private readonly options: PetWindowControllerOptions

  constructor(options: PetWindowControllerOptions) {
    this.options = options
  }

  // ── 生命周期 ──

  async create(config: PetConfig): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      warn('PetWindowController', 'Window already exists')
      return
    }

    this.config = config
    this.resetPanelState()
    const restored = config.windowState
    this.panelPlacement = restored.panelPlacement ?? DEFAULT_PLACEMENT

    const anchorPoint: Point =
      restored.x !== -1 && restored.y !== -1
        ? { x: restored.x, y: restored.y }
        : screen.getCursorScreenPoint()
    const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea
    const bounds = getInitialBounds(workArea, restored)

    const window = new BrowserWindow(buildWindowOptions(bounds, this.options.preloadPath))
    this.window = window

    window.on('closed', () => {
      this.finishDrag(window)
      if (this.window === window) {
        this.window = null
        this.resetPanelState()
      }
    })

    try {
      this.configureWindow(window)
      if (this.options.isDev) {
        await window.loadURL('http://127.0.0.1:5173/pet-window.html')
      } else {
        await window.loadFile(join(__dirname, '../dist/pet-window.html'))
      }
      window.showInactive()
      window.setAlwaysOnTop(true)
      info('PetWindowController', 'Window created')
    } catch (err) {
      if (!window.isDestroyed()) window.destroy()
      if (this.window === window) {
        this.window = null
        this.resetPanelState()
      }
      throw err
    }
  }

  private configureWindow(window: BrowserWindow): void {
    const platform = process.platform
    if (platform === 'darwin') {
      window.setIgnoreMouseEvents(true, { forward: true })
      window.setAlwaysOnTop(true, 'floating')
      window.setVisibleOnAllWorkspaces(true, {
        skipTransformProcessType: true,
        visibleOnFullScreen: true,
      })
    } else {
      window.setIgnoreMouseEvents(false)
      window.setShape([{ x: 0, y: 0, width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }])
    }
  }

  private resetPanelState(): void {
    this.visibleDragRegion = null
    this.panelBounds = null
    this.panelPlacement = DEFAULT_PLACEMENT
    this.pendingMascotAnchorScreenY = null
  }

  async destroy(): Promise<void> {
    const window = this.window
    this.finishDrag(window ?? undefined)
    if (window && !window.isDestroyed()) {
      window.destroy()
    }
    this.window = null
    this.resetPanelState()
  }

  isAlive(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  getConfig(): PetConfig | null {
    return this.config
  }

  /**
   * 主应用写入新 config 时同步。窗口存活时保留当前 windowState（拖拽管理的位置），
   * 避免主应用保存的旧位置覆盖正在拖拽的窗口。
   */
  setConfig(config: PetConfig): void {
    if (this.window && !this.window.isDestroyed() && this.config) {
      this.config = {
        ...config,
        windowState: { ...this.config.windowState },
      }
    } else {
      this.config = config
      this.panelPlacement = config.windowState.panelPlacement ?? DEFAULT_PLACEMENT
    }
  }

  // ── 拖拽（主进程光标采样驱动） ──

  handleDrag(event: { phase: 'start' | 'move' | 'end'; x: number; y: number }): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    if (!isFiniteCoordinate(event.x) || !isFiniteCoordinate(event.y)) {
      warn('PetWindowController', 'Drag coordinates must be finite')
      return
    }

    if (event.phase === 'start') {
      this.finishDrag()
      const bounds = window.getBounds()
      const sampled = screen.getCursorScreenPoint()
      const pointerStart: Position = isPosition(sampled)
        ? { x: sampled.x, y: sampled.y }
        : { x: event.x, y: event.y }
      this.drag = {
        window,
        pointerStart,
        windowStart: { x: bounds.x, y: bounds.y },
        lastPosition: { x: bounds.x, y: bounds.y },
      }
      this.dragTimer = setInterval(
        () => this.sampleDragPosition(),
        PET_WINDOW_DRAG_INTERVAL_MS,
      )
      return
    }

    const drag = this.drag
    if (!drag || drag.window !== window) {
      warn('PetWindowController', 'Drag has not started')
      return
    }

    const payloadPosition: Position = { x: event.x, y: event.y }
    const cursorPosition: Position =
      event.phase === 'end'
        ? this.readCursorScreenPoint() ?? payloadPosition
        : payloadPosition
    this.updateDragPosition(drag, cursorPosition)

    if (event.phase === 'end') {
      this.finishDrag(window)
    }
  }

  private readCursorScreenPoint(): Position | null {
    const point = screen.getCursorScreenPoint()
    return isPosition(point) ? { x: point.x, y: point.y } : null
  }

  private sampleDragPosition(): void {
    const drag = this.drag
    if (!drag || drag.window.isDestroyed()) {
      this.finishDrag(drag?.window)
      return
    }
    const point = this.readCursorScreenPoint()
    if (point) this.updateDragPosition(drag, point)
  }

  private updateDragPosition(drag: DragState, pointer: Position): void {
    const requested: Position = {
      x: drag.windowStart.x + pointer.x - drag.pointerStart.x,
      y: drag.windowStart.y + pointer.y - drag.pointerStart.y,
    }
    const workArea = screen.getDisplayNearestPoint(pointer).workArea
    const next = clampPetWindowPosition(
      requested,
      workArea,
      this.visibleDragRegion ?? undefined,
    )
    if (next.x === drag.lastPosition.x && next.y === drag.lastPosition.y) return

    movePetWindow(drag.window, next)
    drag.lastPosition = next
    // 拖拽是 mascot 触达边缘的唯一途径，因此面板空间检查也在这里发生。
    // 大部分 tick 来自光标采样器而非渲染进程调用，所以通过事件通知渲染进程。
    if (this.visibleDragRegion) {
      this.evaluatePanelPlacement(drag.window, next, workArea, this.visibleDragRegion)
    }
  }

  private finishDrag(window?: BrowserWindow): void {
    const drag = this.drag
    if (window && drag && drag.window !== window) return
    if (this.dragTimer) {
      clearInterval(this.dragTimer)
      this.dragTimer = null
    }
    if (!drag) return
    this.drag = null
    // 把最终位置 + 当前 placement 写入 config（由 petIpcHandlers 持久化）
    if (this.config) {
      this.config.windowState.x = drag.lastPosition.x
      this.config.windowState.y = drag.lastPosition.y
      this.config.windowState.panelPlacement = this.panelPlacement
    }
  }

  // ── 面板贴边翻转 ──

  private evaluatePanelPlacement(
    window: BrowserWindow,
    windowPosition: Position,
    workArea: Rectangle,
    mascot: Rectangle,
  ): void {
    const previous = this.panelPlacement
    const next = resolvePanelPlacement({
      windowPosition,
      workArea,
      mascot,
      panel: this.panelBounds,
      previous,
    })
    if (next === previous) return

    // 翻转本身会移动 mascot 在窗口内的位置，设置锚点让下次 region 报告时补偿窗口 y
    this.pendingMascotAnchorScreenY = windowPosition.y + mascot.y
    this.panelPlacement = next
    if (this.config) {
      this.config.windowState.panelPlacement = next
    }
    this.sendMainWindowEvent({ type: 'panelPlacementChanged', placement: next })
  }

  /**
   * 渲染进程主动报告 placement 变更时更新（一般由主进程翻转后通知，
   * 此方法处理渲染进程自发的情况，如窗口大小变化）。
   */
  updatePanelPlacement(placement: 'above' | 'below'): void {
    this.panelPlacement = placement
    if (this.config) {
      this.config.windowState.panelPlacement = placement
    }
  }

  /**
   * 当渲染进程报告 mascot 区域时，用它来补偿窗口位置，
   * 让 mascot 屏幕坐标在翻转/恢复后保持不变。
   */
  private holdMascotAnchor(mascot: Rectangle, requested: Position): Position {
    const anchorScreenY = this.pendingMascotAnchorScreenY
    if (anchorScreenY === null) return requested
    this.pendingMascotAnchorScreenY = null
    const compensated = { x: requested.x, y: anchorScreenY - mascot.y }
    // 拖拽中的窗口起点也要吸收翻转，否则下一 tick 会算回翻转前位置
    const drag = this.drag
    if (drag) {
      drag.windowStart = {
        ...drag.windowStart,
        y: drag.windowStart.y + compensated.y - requested.y,
      }
    }
    return compensated
  }

  // ── 区域穿透（click-through） ──

  setIgnoreMouseEvents(ignore: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    // Windows/Linux 用 setShape 控制可点击区域，setIgnoreMouseEvents 仅 macOS 生效
    if (process.platform !== 'darwin') return
    window.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
  }

  setInteractiveRegions(regions: PetInteractiveRegion[]): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    const extent = petWindowContentExtent(window)
    const rects = regions.map((r) =>
      normalizeRegion(
        { x: r.x, y: r.y, width: r.width, height: r.height },
        extent,
      ),
    )
    const primary = rects[0] ?? null
    // mascot 是拖拽锚点，拖拽夹紧按它而非整窗口，让 mascot 能贴屏幕边缘
    if (primary) this.visibleDragRegion = primary
    const panel = petPanelBounds(rects)
    this.panelBounds = panel

    // 第一次收到 region 时，根据恢复位置/翻转补偿 mascot 锚点
    if (primary) {
      const bounds = window.getBounds()
      const requested = this.holdMascotAnchor(primary, { x: bounds.x, y: bounds.y })
      const anchor: Point = {
        x: requested.x + primary.x + Math.floor(primary.width / 2),
        y: requested.y + primary.y + Math.floor(primary.height / 2),
      }
      const workArea = screen.getDisplayNearestPoint(anchor).workArea
      const next = clampPetWindowPosition(requested, workArea, primary)
      if (next.x !== bounds.x || next.y !== bounds.y) {
        movePetWindow(window, next)
      }
      this.evaluatePanelPlacement(window, next, workArea, primary)
    }

    // Windows/Linux: setShape 只让交互元素可点击
    if (process.platform !== 'darwin') {
      const shape = rects.map((r) =>
        normalizeRegion(
          {
            x: r.x - PET_WINDOW_SHAPE_PADDING,
            y: r.y - PET_WINDOW_SHAPE_PADDING,
            width: r.width + PET_WINDOW_SHAPE_PADDING * 2,
            height: r.height + PET_WINDOW_SHAPE_PADDING * 2,
          },
          extent,
        ),
      )
      if (shape.length > 0) window.setShape(shape)
    }
  }

  // ── 上下文菜单 ──

  /**
   * 弹出原生上下文菜单，只有"关闭宠物"项。
   * 返回是否点击了关闭（true）或取消/失焦（false）。
   */
  async showContextMenu(locale: 'zh-CN' | 'en-US'): Promise<boolean> {
    const window = this.window
    if (!window || window.isDestroyed()) return false
    const closeLabel = locale === 'en-US' ? 'Close Pet' : '关闭宠物'
    return new Promise<boolean>((resolve) => {
      let settled = false
      const settle = (selected: boolean) => {
        if (settled) return
        settled = true
        resolve(selected)
      }
      const menu = Menu.buildFromTemplate([
        {
          label: closeLabel,
          click: () => settle(true),
        },
      ])
      menu.popup({
        window,
        callback: () => settle(false),
      })
    })
  }

  // ── 状态同步 ──

  syncPetState(payload: PetSyncPayload): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    window.webContents.send('petWindow:stateUpdate', payload)
  }

  // ── 偏好同步 ──

  /** 合并偏好变更到内部 config（不持久化，由 petIpcHandlers 调用 write） */
  syncPreferences(patch: Partial<PetPreferences>): void {
    if (!this.config) return
    this.config.preferences = { ...this.config.preferences, ...patch }
  }

  // ── 主进程 → 宠物窗口事件 ──

  /** 向宠物窗口发送 PetMainWindowEvent（panelPlacementChanged / navigateSession / visibilityChanged） */
  sendMainWindowEvent(event: PetMainWindowEvent): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    window.webContents.send('petMainWindow:event', event)
  }

  dispose(): void {
    this.finishDrag()
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }
}
