/**
 * 沙箱静态产物的资源根 — 打包协议、桌面开发期静态服务与 H5 第二端口共用同一个锚点。
 *
 * 锚点必须是 app path（打包态 = `resources/app.asar`，开发态 = 仓库根），不能是模块自己的
 * `__dirname`：主进程 chunk 会落进 `dist-electron` 的不同层级（`proxy/`、`voice/` 就在子目录，
 * 后者还被 asarUnpack 搬去 `app.asar.unpacked`），按 `__dirname` 反推「../dist」等于把
 * 「装好之后能不能读到沙箱」押在构建器的分块布局上 —— 布局一变，卡片只在安装包里变空白。
 */
import { join } from 'path'

/** 产物相对 app path 的位置，与 `scripts/genui-sandbox-build.mjs` 的输出目录同一条口径。 */
const SANDBOX_RESOURCE_REL_PATH = join('dist', 'genui-sandbox')

export function resolveSandboxResourceRoot(appPath: string): string {
  return join(appPath, SANDBOX_RESOURCE_REL_PATH)
}
