/**
 * srcdoc 文档构建入口 — 实现已移到 `src/shared/previewDocument.ts`，
 * 主进程的 `spacecode-preview://` 协议也要用同一份注入脚本。
 */
export {
  buildBridgedDocument as buildSrcdoc,
  stripCspMeta,
} from '@/shared/previewDocument'
export type { PreviewBridgeOptions as SrcdocBridgeOptions } from '@/shared/previewDocument'
