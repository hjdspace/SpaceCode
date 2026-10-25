/**
 * `genui-sandbox-build.mjs` 的类型面：消费方是 `vite.config.mts` 与测试，
 * 两边都在 tsconfig 的检查范围内，所以给显式声明而不是隐式 any。
 */
export const SANDBOX_ENTRY_FILE: string
/** 沙箱外壳样式文件名；`sandbox.css` 留给 esbuild 从物料 CSS import 收集出来的产物。 */
export const SANDBOX_THEME_FILE: string

export type SandboxBuildOptions = {
  /** 仓库根，由调用方给出（Vite 会把配置文件打进临时文件，反推不可靠） */
  repoRoot?: string
  outDir?: string
}

export function buildGenuiSandbox(options?: SandboxBuildOptions): Promise<string>

export function watchGenuiSandbox(options?: SandboxBuildOptions): Promise<() => Promise<void>>
