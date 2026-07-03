import { ipcMain } from 'electron';
import { composeSystemPrompt, ComposeInput } from './prompts/system';
import * as fs from 'fs/promises';
import * as path from 'path';

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
    const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib');
    try {
      const dirs = await fs.readdir(systemsLibDir, { withFileTypes: true });
      const systems = [];
      for (const dir of dirs) {
        if (dir.isDirectory() && !dir.name.startsWith('.')) {
          let manifest: any = { name: dir.name, category: 'General' };
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
          });
        }
      }
      return systems;
    } catch {
      return [
        { id: 'stripe', name: 'Stripe', category: 'Fintech' },
        { id: 'linear-app', name: 'Linear', category: 'Productivity' },
        { id: 'vercel', name: 'Vercel', category: 'Developer' },
        { id: 'apple', name: 'Apple iOS', category: 'Corporate' }
      ];
    }
  });
}
