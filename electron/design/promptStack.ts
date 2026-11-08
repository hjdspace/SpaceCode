import { ipcMain } from 'electron';
import { composeSystemPrompt, ComposeInput } from './prompts/system';
import { renderDesignSystemShowcase } from './showcase';
import {
  createUserDesignSystem,
  deleteUserDesignSystem,
  directoryExists,
  isSafeDesignSystemId,
  type CreateUserDesignSystemInput,
} from './userSystems';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface PreviewPage {
  path: string;
  role: string;
  title: string;
}

export interface DesignSystemSwatch {
  name: string;
  value: string;
}

export type DesignSystemSource = 'built-in' | 'user';

export interface DesignSystemSummary {
  id: string;
  name: string;
  category: string;
  description?: string;
  previewPages: PreviewPage[];
  swatches?: DesignSystemSwatch[];
  officialUrl?: string;
  /** 缺失即 built-in：随包只读库里的一律不可删改。 */
  source?: DesignSystemSource;
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

/**
 * 预设设计系统 ID → 官网 URL 映射。
 * 参考 open-design 的 OFFICIAL_PRESET_DOMAINS。
 * 仅包含有明确官网且设计系统 ID 匹配的系统。
 */
const OFFICIAL_URL_PRESETS: Record<string, string> = {
  'airbnb': 'https://airbnb.com',
  'airtable': 'https://airtable.com',
  'ant': 'https://ant.design',
  'apple': 'https://apple.com',
  'arc': 'https://arc.net',
  'binance': 'https://binance.com',
  'bmw': 'https://bmw.com',
  'bmw-m': 'https://bmw-m.com',
  'bugatti': 'https://bugatti.com',
  'cal': 'https://cal.com',
  'canva': 'https://canva.com',
  'cisco': 'https://cisco.com',
  'claude': 'https://claude.ai',
  'clay': 'https://clay.com',
  'clickhouse': 'https://clickhouse.com',
  'cohere': 'https://cohere.com',
  'coinbase': 'https://coinbase.com',
  'composio': 'https://composio.dev',
  'cursor': 'https://cursor.com',
  'discord': 'https://discord.com',
  'duolingo': 'https://duolingo.com',
  'elevenlabs': 'https://elevenlabs.io',
  'expo': 'https://expo.dev',
  'ferrari': 'https://ferrari.com',
  'figma': 'https://figma.com',
  'framer': 'https://framer.com',
  'github': 'https://github.com',
  'hashicorp': 'https://hashicorp.com',
  'huggingface': 'https://huggingface.co',
  'ibm': 'https://ibm.com',
  'intercom': 'https://intercom.com',
  'kraken': 'https://kraken.com',
  'lamborghini': 'https://lamborghini.com',
  'linear-app': 'https://linear.app',
  'lingo': 'https://lingo.dev',
  'loom': 'https://loom.com',
  'lovable': 'https://lovable.dev',
  'mastercard': 'https://mastercard.com',
  'material': 'https://material.io',
  'meta': 'https://meta.com',
  'minimax': 'https://minimax.io',
  'miro': 'https://miro.com',
  'mistral': 'https://mistral.ai',
  'mistral-ai': 'https://mistral.ai',
  'mongodb': 'https://mongodb.com',
  'nike': 'https://nike.com',
  'notion': 'https://notion.so',
  'nvidia': 'https://nvidia.com',
  'ollama': 'https://ollama.com',
  'openai': 'https://openai.com',
  'perplexity': 'https://perplexity.ai',
  'pinterest': 'https://pinterest.com',
  'posthog': 'https://posthog.com',
  'raycast': 'https://raycast.com',
  'renault': 'https://renault.com',
  'replicate': 'https://replicate.com',
  'resend': 'https://resend.com',
  'revolut': 'https://revolut.com',
  'sanity': 'https://sanity.io',
  'sentry': 'https://sentry.io',
  'shadcn': 'https://ui.shadcn.com',
  'shopify': 'https://shopify.com',
  'slack': 'https://slack.com',
  'spacex': 'https://spacex.com',
  'spotify': 'https://spotify.com',
  'starbucks': 'https://starbucks.com',
  'stripe': 'https://stripe.com',
  'supabase': 'https://supabase.com',
  'superhuman': 'https://superhuman.com',
  'tesla': 'https://tesla.com',
  'uber': 'https://uber.com',
  'vercel': 'https://vercel.com',
  'vodafone': 'https://vodafone.com',
  'warp': 'https://warp.dev',
  'webex': 'https://webex.com',
  'webflow': 'https://webflow.com',
  'wechat': 'https://wechat.com',
  'wise': 'https://wise.com',
  'zapier': 'https://zapier.com',
};

function isColorValue(value: string): boolean {
  return /^#([0-9A-Fa-f]{3,8})$/i.test(value) ||
    /^rgb\(/i.test(value) ||
    /^rgba\(/i.test(value) ||
    /^hsl\(/i.test(value) ||
    /^hwb\(/i.test(value) ||
    /^oklch\(/i.test(value) ||
    /^lab\(/i.test(value);
}

export function parseSwatchesFromTokensCss(tokensCss: string): DesignSystemSwatch[] {
  const swatches: DesignSystemSwatch[] = [];
  const seen = new Set<string>();
  const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  const priorityNames = ['--bg', '--surface', '--fg', '--accent', '--muted', '--border', '--success', '--warn', '--danger'];
  while ((match = regex.exec(tokensCss)) !== null) {
    const name = match[1];
    const rawValue = match[2].trim();
    if (seen.has(name)) continue;
    const value = rawValue.replace(/var\(([^)]+)\)/g, '').trim() || rawValue;
    if (!isColorValue(value)) continue;
    seen.add(name);
    swatches.push({ name, value });
  }
  swatches.sort((a, b) => {
    const ia = priorityNames.indexOf(a.name);
    const ib = priorityNames.indexOf(b.name);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
  return swatches.slice(0, 8);
}

async function parseSwatchesFromDesignTokens(systemPath: string): Promise<DesignSystemSwatch[]> {
  try {
    const raw = await fs.readFile(path.join(systemPath, 'design-tokens.json'), 'utf-8');
    const data = JSON.parse(raw);
    const tokens: Array<{ name: string; value: string; type?: string; layer?: string }> = Array.isArray(data?.tokens) ? data.tokens : [];
    const colorTokens = tokens.filter((t) => t.type === 'color' && /^#/.test(t.value));
    const priority = ['--bg', '--surface', '--fg', '--accent', '--muted', '--border'];
    colorTokens.sort((a, b) => {
      const ia = priority.indexOf(a.name);
      const ib = priority.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
    return colorTokens.slice(0, 8).map((t) => ({ name: t.name, value: t.value }));
  } catch {
    return [];
  }
}

function bundledLibDir(extraResourcesPath: string): string {
  return path.join(extraResourcesPath, 'design-systems-lib');
}

/**
 * 同一个 id 可能在两个库里：用户自建优先（自建就是为了盖住同名的预设）。
 * 返回的是**根目录**而不是系统目录，好让下面所有读取沿用自己的既有签名。
 * 目录不存在时也返回随包根 —— 保持「读不到就是空串」的既有行为，不新增分支。
 */
async function resolveSystemsRoot(
  extraResourcesPath: string,
  systemId: string,
  userSystemsPath?: string
): Promise<string> {
  const libDir = bundledLibDir(extraResourcesPath);
  if (userSystemsPath && isSafeDesignSystemId(systemId)) {
    if (await directoryExists(path.join(userSystemsPath, systemId))) return userSystemsPath;
  }
  return libDir;
}

/** 拼出 `<root>/<systemId>/<filePath>` 并保证结果没跑出根目录。 */
function containedPath(root: string, systemId: string, filePath: string): string | null {
  if (!isSafeDesignSystemId(systemId)) return null;
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(absRoot, systemId, filePath);
  return absTarget.startsWith(absRoot + path.sep) ? absTarget : null;
}

export async function getSystemFile(
  extraResourcesPath: string,
  systemId: string,
  filePath: string,
  userSystemsPath?: string
): Promise<string> {
  const root = await resolveSystemsRoot(extraResourcesPath, systemId, userSystemsPath);
  const fullPath = containedPath(root, systemId, filePath);
  if (!fullPath) return '';
  return fs.readFile(fullPath, 'utf-8').catch(() => '');
}

export async function getSystemShowcaseHtml(
  extraResourcesPath: string,
  systemId: string,
  userSystemsPath?: string
): Promise<string> {
  const designMd = await getSystemFile(extraResourcesPath, systemId, 'DESIGN.md', userSystemsPath);
  if (designMd) {
    return renderDesignSystemShowcase(systemId, designMd);
  }

  const candidates = ['system/kit.html', 'system/index.html', 'preview/app.html', 'components.html'];
  for (const candidate of candidates) {
    const html = await getSystemFile(extraResourcesPath, systemId, candidate, userSystemsPath);
    if (html) {
      return getSystemPreviewHtml(extraResourcesPath, systemId, candidate, userSystemsPath);
    }
  }
  return '';
}

export async function getSystemTokensHtml(
  extraResourcesPath: string,
  systemId: string,
  userSystemsPath?: string
): Promise<string> {
  const tokensCss = await getSystemFile(extraResourcesPath, systemId, 'tokens.css', userSystemsPath);
  if (!tokensCss) return '';

  const swatches = parseSwatchesFromTokensCss(tokensCss);
  const swatchHtml = swatches.map((s) => {
    const isLight = isLightColor(s.value);
    return `
      <div class="swatch">
        <div class="swatch-color" style="background:${s.value};color:${isLight ? '#000' : '#fff'}">${s.name}</div>
        <div class="swatch-meta">
          <span class="swatch-name">${s.name}</span>
          <span class="swatch-value">${s.value}</span>
        </div>
      </div>`;
  }).join('');

  const cssVariables: DesignSystemSwatch[] = [];
  const seenVars = new Set<string>();
  const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tokensCss)) !== null) {
    const name = match[1];
    if (seenVars.has(name)) continue;
    seenVars.add(name);
    cssVariables.push({ name, value: match[2].trim() });
  }

  const rows = cssVariables.map((v) => `
    <tr>
      <td><code>${v.name}</code></td>
      <td><code>${v.value.replace(/</g, '&lt;')}</code></td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Design Tokens</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 32px;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fafafa;
      color: #111;
      line-height: 1.5;
    }
    h1 { font-size: 20px; margin: 0 0 20px; }
    .swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 28px; }
    .swatch { border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; background: #fff; }
    .swatch-color { height: 64px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; padding: 0 8px; text-align: center; }
    .swatch-meta { padding: 8px 10px; font-size: 11px; }
    .swatch-name { display: block; font-weight: 600; color: #111; }
    .swatch-value { display: block; color: #6b6b6b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #f0f0f0; }
    th { background: #f5f5f5; font-weight: 600; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Tokens</h1>
  <div class="swatches">${swatchHtml}</div>
  <table>
    <thead><tr><th>Token</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

function isLightColor(hexColor: string): boolean {
  const hex = hexColor.replace('#', '');
  if (!/^[0-9A-Fa-f]{3,8}$/.test(hex)) return false;
  const full = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (...args: any[]) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let lastIndex = 0;
  const promises: Promise<{ replacement: string; index: number }>[] = [];

  str.replace(regex, (...args) => {
    const match = args[0];
    const offset = args[args.length - 2];
    parts.push(str.slice(lastIndex, offset));
    // index 必须在同步回调里捕获；放进 .then 回调会在整个 replace 循环结束后
    // 才求值，多资源时全部拿到同一个越界下标 —— 占位符留空、替换体丢到文档末尾。
    const index = parts.length;
    promises.push(asyncFn(...args).then(replacement => ({ replacement, index })));
    parts.push('');
    lastIndex = offset + match.length;
    return '';
  });

  parts.push(str.slice(lastIndex));
  const replacements = await Promise.all(promises);

  for (const { replacement, index } of replacements) {
    parts[index] = replacement;
  }

  return parts.join('');
}

async function inlineLocalStylesheets(html: string, baseDir: string): Promise<string> {
  const linkRegex = /<link[^>]*>/gi;
  return replaceAsync(html, linkRegex, async (match: string) => {
    const hrefMatch = match.match(/\s?href=["']([^"']+)["']/i);
    const relMatch = match.match(/\s?rel=["']([^"']+)["']/i);
    if (!hrefMatch || !relMatch || !/stylesheet/i.test(relMatch[1])) return match;
    const href = hrefMatch[1];
    // 协议守卫要跳过整段 scheme（https: / data: / file: …），量词不能少 ——
    // 少了 * 时 data: 图片会被下面的改写拼成损坏的 file:// 路径。
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return match;
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
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return match;
    const jsPath = path.resolve(baseDir, src);
    const js = await fs.readFile(jsPath, 'utf-8').catch(() => '');
    if (!js) return match;
    return `<script>${js}</script>`;
  });
}

export async function getSystemPreviewHtml(
  extraResourcesPath: string,
  systemId: string,
  pagePath: string,
  userSystemsPath?: string
): Promise<string> {
  const root = await resolveSystemsRoot(extraResourcesPath, systemId, userSystemsPath);
  const fullPath = containedPath(root, systemId, pagePath);
  if (!fullPath) return '';
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
      if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return `${attr}="${rel}"`;
      const resolved = path.resolve(pageDir, rel);
      return `${attr}="file://${resolved.replace(/\\/g, '/')}"`;
    }
  );
  return html;
}

async function describeDesignSystem(
  systemPath: string,
  id: string,
  source: DesignSystemSource
): Promise<DesignSystemSummary> {
  let manifest: any = { name: id, category: 'General', previewPages: [] };
  try {
    const manifestStr = await fs.readFile(path.join(systemPath, 'manifest.json'), 'utf-8');
    manifest = JSON.parse(manifestStr);
  } catch {
    // No manifest, fallback to folder name
  }
  let swatches: DesignSystemSwatch[] = [];
  const designTokensSwatches = await parseSwatchesFromDesignTokens(systemPath);
  if (designTokensSwatches.length > 0) {
    swatches = designTokensSwatches;
  } else {
    try {
      const tokensCss = await fs.readFile(path.join(systemPath, 'tokens.css'), 'utf-8');
      swatches = parseSwatchesFromTokensCss(tokensCss);
    } catch {
      swatches = [];
    }
  }
  const officialUrl: string | undefined =
    manifest.officialUrl || manifest.website || OFFICIAL_URL_PRESETS[id];
  return {
    id,
    name: manifest.name || id,
    category: manifest.category || 'General',
    description: manifest.description,
    previewPages: manifest.preview?.pages || [],
    swatches,
    officialUrl,
    source,
  };
}

async function listDesignSystemsInRoot(
  rootDir: string,
  source: DesignSystemSource
): Promise<DesignSystemSummary[]> {
  const dirs = await fs.readdir(rootDir, { withFileTypes: true });
  const systems: DesignSystemSummary[] = [];
  for (const dir of dirs) {
    if (dir.isDirectory() && !dir.name.startsWith('.')) {
      systems.push(await describeDesignSystem(path.join(rootDir, dir.name), dir.name, source));
    }
  }
  return systems;
}

export async function listDesignSystems(
  extraResourcesPath: string,
  userSystemsPath?: string
): Promise<DesignSystemSummary[]> {
  // 随包库读不到要照常抛错 —— 上层 IPC 靠它回退到占位清单；用户库缺失是常态。
  const builtIn = await listDesignSystemsInRoot(
    bundledLibDir(extraResourcesPath),
    'built-in'
  );
  if (!userSystemsPath) return builtIn;

  const entries = await fs.readdir(userSystemsPath, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  // 新建的排在最前：刚创建完就想用它，不该滚到列表尾部去找
  const withMtime = await Promise.all(
    candidates.map(async (dir) => ({
      name: dir.name,
      mtimeMs: (await fs.stat(path.join(userSystemsPath, dir.name)).catch(() => null))?.mtimeMs ?? 0,
    }))
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const user = await Promise.all(
    withMtime.map((entry) =>
      describeDesignSystem(path.join(userSystemsPath, entry.name), entry.name, 'user')
    )
  );
  const userIds = new Set(withMtime.map((entry) => entry.name));
  return [...user, ...builtIn.filter((s) => !userIds.has(s.id))];
}

/**
 * 注册提示词栈相关的 Electron IPC Handler
 */
export function registerPromptStackHandlers(
  extraResourcesPath: string,
  userSystemsPath: string
) {
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
        const systemsRoot = await resolveSystemsRoot(
          extraResourcesPath,
          input.designSystemId,
          userSystemsPath
        );
        designSystem = await readDesignSystemAssets(systemsRoot, input.designSystemId);
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
      return await listDesignSystems(extraResourcesPath, userSystemsPath);
    } catch {
      return [
        { id: 'stripe', name: 'Stripe', category: 'Fintech', previewPages: [] },
        { id: 'linear-app', name: 'Linear', category: 'Productivity', previewPages: [] },
        { id: 'vercel', name: 'Vercel', category: 'Developer', previewPages: [] },
        { id: 'apple', name: 'Apple iOS', category: 'Corporate', previewPages: [] }
      ];
    }
  });

  ipcMain.handle('design:create-system', async (_event, input: CreateUserDesignSystemInput) => {
    // 内置 id 要先预留：用户建的项目录撞名会遮蔽同名预设，
    // 让位成 <slug>-2 才能保证列表里一条名字只对应一套系统。
    const builtInIds = await fs.readdir(bundledLibDir(extraResourcesPath)).catch(() => []);
    const created = await createUserDesignSystem(userSystemsPath, input, new Set(builtInIds));
    return describeDesignSystem(path.join(userSystemsPath, created.id), created.id, 'user');
  });

  ipcMain.handle('design:delete-system', async (_event, systemId: string) => {
    await deleteUserDesignSystem(userSystemsPath, systemId);
  });

  ipcMain.handle('design:get-system-preview', async (_event, systemId: string, pagePath: string) => {
    return getSystemPreviewHtml(extraResourcesPath, systemId, pagePath, userSystemsPath);
  });

  ipcMain.handle('design:get-system-file', async (_event, systemId: string, filePath: string) => {
    return getSystemFile(extraResourcesPath, systemId, filePath, userSystemsPath);
  });

  ipcMain.handle('design:get-system-showcase', async (_event, systemId: string) => {
    return getSystemShowcaseHtml(extraResourcesPath, systemId, userSystemsPath);
  });

  ipcMain.handle('design:get-system-tokens-html', async (_event, systemId: string) => {
    return getSystemTokensHtml(extraResourcesPath, systemId, userSystemsPath);
  });
}
