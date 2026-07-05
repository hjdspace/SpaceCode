import { ipcMain } from 'electron';
import { composeSystemPrompt, ComposeInput } from './prompts/system';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PreviewPage {
  path: string;
  role: string;
  title: string;
}

export interface DesignSystemSummary {
  id: string;
  name: string;
  category: string;
  description?: string;
  previewPages: PreviewPage[];
}

/**
 * 扫描并读取指定的设计系统资产
 */
export interface DesignSystemAssets {
  designMd: string;
  tokensCss: string;
  componentsManifest?: string;
}

export async function readDesignSystemAssets(
  baseDir: string,
  systemId: string
): Promise<DesignSystemAssets> {
  const systemPath = path.join(baseDir, systemId);
  let designMd = '';
  let tokensCss = '';
  let componentsManifest = '';

  try {
    designMd = await fs.readFile(path.join(systemPath, 'DESIGN.md'), 'utf-8');
  } catch {
    designMd = `[DESIGN RULES FOR ${systemId.toUpperCase()}]
- Create a clean and modern design conforming to ${systemId} style.`;
  }

  try {
    tokensCss = await fs.readFile(path.join(systemPath, 'tokens.css'), 'utf-8');
  } catch {
    tokensCss = `/* No custom tokens available for ${systemId} */
:root {
  --color-primary: #000;
}`;
  }

  try {
    componentsManifest = await fs.readFile(path.join(systemPath, 'manifest.json'), 'utf-8');
  } catch {
    componentsManifest = '';
  }

  return { designMd, tokensCss, componentsManifest };
}

export async function getSystemPreviewHtml(
  extraResourcesPath: string,
  systemId: string,
  pagePath: string
): Promise<string> {
  const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib');
  const fullPath = path.join(systemsLibDir, systemId, pagePath);
  let html = await fs.readFile(fullPath, 'utf-8').catch(() => '');
  if (!html) return '';

  // 将 ../tokens.css 等相对路径替换为 file:// 绝对路径
  const systemDir = path.join(systemsLibDir, systemId);
  html = html.replace(
    /(href|src)="([^"]+)"/g,
    (_match, attr, rel) => {
      if (/^[a-z][a-z0-9+.-]:/i.test(rel)) return `${attr}="${rel}"`;
      const resolved = path.resolve(systemDir, rel);
      return `${attr}="file://${resolved.replace(/\\/g, '/')}"`;
    }
  );
  return html;
}

export async function listDesignSystems(extraResourcesPath: string): Promise<DesignSystemSummary[]> {
  const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib');
  const dirs = await fs.readdir(systemsLibDir, { withFileTypes: true });
  const systems: DesignSystemSummary[] = [];
  for (const dir of dirs) {
    if (dir.isDirectory() && !dir.name.startsWith('.')) {
      let manifest: any = { name: dir.name, category: 'General', previewPages: [] };
      try {
        const manifestStr = await fs.readFile(path.join(systemsLibDir, dir.name, 'manifest.json'), 'utf-8');
        manifest = JSON.parse(manifestStr);
      } catch {
        // No manifest, fallback to folder name
      }
      systems.push({
        id: dir.name,
        name: manifest.name || dir.name,
        category: manifest.category || 'General',
        description: manifest.description,
        previewPages: manifest.preview?.pages || [],
      });
    }
  }
  return systems;
}

/**
 * 注册提示词栈相关的 Electron IPC Handler
 */
export function registerPromptStackHandlers(extraResourcesPath: string) {
  ipcMain.handle(
    'design:compose-prompt-stack',
    async (_event, input: {
      designSystemId?: string;
      skillBody?: string;
      skillName?: string;
      locale: string;
    }) => {
      let designSystem: DesignSystemAssets | undefined;
      
      if (input.designSystemId) {
        // 扫 extraResources 下的 design-systems-lib 目录
        const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib');
        designSystem = await readDesignSystemAssets(systemsLibDir, input.designSystemId);
      }

      const composeInput: ComposeInput = {
        sessionMode: 'design',
        executionProfile: 'filesystem', // SpaceCode 使用文件系统执行模式
        locale: input.locale,
        skillBody: input.skillBody,
        skillName: input.skillName,
        designSystemBody: designSystem?.designMd,
        designSystemTitle: input.designSystemId,
        designSystemTokensCss: designSystem?.tokensCss,
        designSystemComponentsManifest: designSystem?.componentsManifest,
        critique: true, // 开启 5 维自评批判
      };

      return composeSystemPrompt(composeInput);
    }
  );

  ipcMain.handle('design:list-systems', async () => {
    try {
      return await listDesignSystems(extraResourcesPath);
    } catch {
      return [
        { id: 'stripe', name: 'Stripe', category: 'Fintech', previewPages: [] },
        { id: 'linear-app', name: 'Linear', category: 'Productivity', previewPages: [] },
        { id: 'vercel', name: 'Vercel', category: 'Developer', previewPages: [] },
        { id: 'apple', name: 'Apple iOS', category: 'Corporate', previewPages: [] }
      ];
    }
  });

  ipcMain.handle('design:get-system-preview', async (_event, systemId: string, pagePath: string) => {
    return getSystemPreviewHtml(extraResourcesPath, systemId, pagePath);
  });
}
