/**
 * SkillInstaller — Deep Module for Skill Installation Policy
 *
 * Single source of truth for link→copy fallback installation.
 * Replaces the 4+ duplicated install-policy blocks that were previously
 * inlined in service.ts (writeSkillToCenter, executeDistribute, executeAdopt,
 * executeApplyPack).
 *
 * Interface (small): install() — one method, one policy.
 * Implementation (deep): symlink creation, Windows fallback, hash computation.
 *
 * Design rationale (see codebase-design SKILL):
 * - Depth: 4 call sites collapse to one interface.
 * - Locality: link-fail policy bug fixed here, fixed everywhere.
 * - Testability: injected fs operations → link-fail path testable.
 */

import * as path from 'path'

import {
  copyDirRecursive,
  createLink,
  hashDir,
  removePath,
  pathExists,
  type CreateLinkResult,
} from './fsutil'
import type { InstallMode, LinkFailPolicy } from '@/types/skillManagerV2'

// ── Public types ────────────────────────────────────────────────────

/** Result of installing a skill from source to destination. */
export interface InstallResult {
  /** The mode that was actually used ('link' succeeded, or 'copy' fallback). */
  actualMode: 'link' | 'copy'
  /** Hash of the destination directory after installation. */
  hash: string
  /** Error message if installation failed; null on success. */
  error: string | null
}

// ── Seams for testability ────────────────────────────────────────────

/**
 * Injectable filesystem operations.
 * Production uses the real fs-backed defaults; tests can stub these.
 */
export interface InstallerFs {
  createLink(centerPath: string, targetPath: string, linkFailPolicy: LinkFailPolicy): CreateLinkResult
  copyDirRecursive(src: string, dst: string): void
  removePath(p: string): void
  pathExists(p: string): boolean
  hashDir(dir: string): string
}

const defaultFs: InstallerFs = {
  createLink,
  copyDirRecursive,
  removePath,
  pathExists,
  hashDir,
}

// ── Deep module ─────────────────────────────────────────────────────

/**
 * SkillInstaller — the single install policy for skill distribution.
 *
 * One method (`install`), one policy (link→copy fallback per linkFailPolicy).
 * All 4+ former call sites in service.ts now delegate here.
 */
export class SkillInstaller {
  constructor(
    /** Link-fail policy from settings — the single knob. */
    private readonly linkFailPolicy: () => LinkFailPolicy,
    /** Injectable fs operations (defaults to real fs). */
    private readonly fs: InstallerFs = defaultFs,
  ) {}

  /**
   * Install a skill from `sourceDir` to `destPath`.
   *
   * Policy:
   * - If mode is 'link': attempt symlink; on failure, fall back to copy
   *   when linkFailPolicy is 'copy' (the default).
   * - If mode is 'copy': copy the directory.
   * - Destination is cleared first if it already exists.
   *
   * Returns the actual mode used and a hash of the destination.
   */
  install(sourceDir: string, destPath: string, mode: InstallMode): InstallResult {
    // Clear existing destination
    if (this.fs.pathExists(destPath)) {
      this.fs.removePath(destPath)
    }

    // Ensure parent directory exists
    const parent = path.dirname(destPath)

    if (mode === 'link') {
      // The fs.createLink already handles mkdir for parent,
      // but we ensure it here for consistency with copy path.
      const linkResult = this.fs.createLink(sourceDir, destPath, this.linkFailPolicy())
      if (linkResult.error) {
        return {
          actualMode: linkResult.actualMode,
          hash: '',
          error: linkResult.error,
        }
      }
      return {
        actualMode: linkResult.actualMode,
        hash: this.fs.hashDir(destPath),
        error: null,
      }
    }

    // Copy mode
    try {
      this.fs.copyDirRecursive(sourceDir, destPath)
      return {
        actualMode: 'copy',
        hash: this.fs.hashDir(destPath),
        error: null,
      }
    } catch (e) {
      return {
        actualMode: 'copy',
        hash: '',
        error: (e as Error).message,
      }
    }
  }

  /**
   * Install from center to agent target path.
   * Convenience wrapper for the distribute / applyPack paths where
   * the source is always the center library path.
   */
  installToTarget(
    centerPath: string,
    targetPath: string,
    mode: InstallMode,
  ): InstallResult {
    return this.install(centerPath, targetPath, mode)
  }
}
