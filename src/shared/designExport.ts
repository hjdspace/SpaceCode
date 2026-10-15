/**
 * 设计产物导出的跨边界契约 — main handler、preload、渲染层共用一份声明，
 * 免得同一个 IPC 形状抄四遍后各自漂移。
 *
 * 未走 channelMap 的 defineNamespace：design 命名空间还没迁移，这里只桥接类型。
 */
export type DesignExportFormat = 'html' | 'zip' | 'pdf'

export interface DesignExportRequest {
  filePath: string
  format: DesignExportFormat
  /** 设计工作区根；省略时退到产物所在目录 */
  workspaceRoot?: string
}

/** 成功带回产物路径（html 是产物所在目录），失败带回错误说明 */
export type DesignExportResult = { ok: true; path: string } | { ok: false; error: string }
