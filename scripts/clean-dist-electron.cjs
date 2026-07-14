const { rmSync } = require('node:fs')
const { resolve } = require('node:path')

const outputDir = resolve(__dirname, '..', 'dist-electron')

rmSync(outputDir, { recursive: true, force: true })
