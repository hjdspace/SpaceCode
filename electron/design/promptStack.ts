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

async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (...args: any[]) => Promise<string>,
): Promise<string> {
  const promises: Promise<string>[] = [];
  str.replace(regex, (...args) => {
    promises.push(asyncFn(...args));
    return '';
  });
  const replacements = await Promise.all(promises);
  let i = 0;
  return str.replace(regex, () => replacements[i++]);
}

async function inlineLocalStylesheets(html: string, baseDir: string): Promise<string> {
  const linkRegex = /<link[^>]*>/gi;
  return replaceAsync(html, linkRegex, async (match: string) => {
    const hrefMatch = match.match(/\s?href=["']([^"']+)["']/i);
    const relMatch = match.match(/\s?rel=["']([^"']+)["']/i);
    if (!hrefMatch || !relMatch || !/stylesheet/i.test(relMatch[1])) return match;
    const href = hrefMatch[1];
    if (/^[a-z][a-z0-9+.-]:/i.test(href)) return match;
    const cssPath = path.resolve(baseDir, href);
    const css = await fs.readFile(cssPath, 'utf-8').catch(() => '');
    if (!css) return match;
    return `<style>${css}</style>`;
  });
}

async function inlineLocalScripts(html: string, baseDir: string): Promise<string> {
  const scriptRegex = /<script[^>]*>\s*<\/script>/gi;
  return replaceAsync(html, scriptRegex, async (match: string) => {
    const srcMatch = match.match(/\s?src=["']([^"']+)["']/i);
    if (!srcMatch) return match;
    const src = srcMatch[1];
    if (/^[a-z][a-z0-9+.-]:/i.test(src)) return match;
    const jsPath = path.resolve(baseDir, src);
    const js = await fs.readFile(jsPath, 'utf-8').catch(() => '');
    if (!js) return match;
    return `<script>${js}</script>`;
  });
}

export async function getSystemPreviewHtml(
  extraResourcesPath: string,
  systemId: string,
  pagePath: string
): Promise<string> {
  const systemsLibDir = path.join(extraResourcesPath, 'design-systems-lib');
  const systemDir = path.join(systemsLibDir, systemId);
  const fullPath = path.join(systemDir, pagePath);
  const pageDir = path.dirname(fullPath);
  let html = await fs.readFile(fullPath, 'utf-8').catch(() => '');
  if (!html) return '';

  // 将本地样式表/脚本内联，避免 iframe srcdoc 无法加载 file:// 资源
  html = await inlineLocalStylesheets(html, pageDir);
  html = await inlineLocalScripts(html, pageDir);

  // 其余相对路径替换为 file:// 绝对路径（图片等，仍可能被浏览器拦截）
  html = html.replace(
    /(href|src)="([^"]+)"/g,
    (_match, attr, rel) => {
      if (/^[a-z][a-z0-9+.-]:/i.test(rel)) return `${attr}="${rel}"`;
      const resolved = path.resolve(pageDir, rel);
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
