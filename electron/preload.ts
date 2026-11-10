// 构建入口：vite 按入口文件名产出 dist-electron/preload.js（mainWindow.ts 依赖该路径）。
// 实际装配在 ./preload/index.ts，按域拆分。
import './preload/index'
