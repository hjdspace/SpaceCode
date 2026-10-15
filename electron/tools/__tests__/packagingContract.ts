import { vi } from 'vitest'
import { join } from 'path'

/**
 * The two links that decide whether a bundled resource reaches a user:
 * electron-builder copies only what `build.extraResources` declares, and a release
 * build only declares what CI populated first. A dev run exercises neither — the
 * repo copy is already on disk — so every resource a packaged lookup depends on has
 * to assert both, from the module that resolves it.
 */

interface ExtraResource {
  from: string
  to: string
}

const WORKFLOW = join('.github', 'workflows', 'build-release.yml')

async function readReal(path: string): Promise<string> {
  // The suites that mock 'fs' share this module, so read through importActual.
  const { readFileSync } = await vi.importActual<typeof import('fs')>('fs')
  return readFileSync(path, 'utf-8')
}

/**
 * Assert that the directory a packaged lookup resolves under `process.resourcesPath`
 * is declared for copying into the installer.
 *
 * @param shippedDir dir relative to `process.resourcesPath`, e.g. `browser-use`
 */
export async function expectDeclaredInExtraResources(shippedDir: string): Promise<ExtraResource> {
  const pkg = JSON.parse(await readReal(join(process.cwd(), 'package.json')))
  const entries: ExtraResource[] = pkg.build.extraResources
  const entry = entries.find((e) => e.to === shippedDir)
  if (!entry) {
    throw new Error(
      `package.json build.extraResources must ship "./${shippedDir}" — packaged lookups only see process.resourcesPath`,
    )
  }
  return entry
}

/**
 * Assert `fileName` is committed under `entry.from`, so a clean CI checkout already
 * has the payload electron-builder will copy.
 */
export async function expectCommittedFile(entry: ExtraResource, fileName: string): Promise<void> {
  const { existsSync } = await vi.importActual<typeof import('fs')>('fs')
  const target = join(process.cwd(), entry.from, fileName)
  if (!existsSync(target)) {
    throw new Error(`${entry.from}/${fileName} must be committed — CI packages straight from the checkout`)
  }
}

/**
 * Assert the release job runs `scriptFragment` to fill `entry.from` before
 * electron-builder copies it. Used when the payload is gitignored, so a clean CI
 * checkout alone would ship an empty directory.
 */
export async function expectPopulatedByReleaseJob(entry: ExtraResource, scriptFragment: string): Promise<void> {
  const workflow = await readReal(join(process.cwd(), WORKFLOW))
  const downloadAt = workflow.indexOf(scriptFragment)
  const builderAt = workflow.indexOf('electron-builder')

  if (downloadAt < 0) {
    throw new Error(
      `${entry.from} commits no payload — build-release.yml must run ${scriptFragment} before packaging`,
    )
  }
  if (builderAt >= 0 && downloadAt > builderAt) {
    throw new Error(`${scriptFragment} must run before electron-builder copies ${entry.from}`)
  }
}
