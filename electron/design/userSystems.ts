import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 用户自建设计系统库。与随包只读的 design-systems-lib 分目录存放：
 * 只读资源装在 Program Files 下（打包后不可写），自建项必须落在 userData。
 *
 * 落盘格式对齐 open-design 与 resources/design-systems-lib 的房屋风格：
 * DESIGN.md 是唯一必需文件（showcase 预览、Tokens 面板、提示词栈都只吃它），
 * tokens.css 供色板抓取，manifest.json 供列表取名字/分类。
 */

export interface CreateUserDesignSystemInput {
  title: string;
  category?: string;
  summary?: string;
  accentColor?: string;
}

export interface CreatedDesignSystem {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface DesignSystemPalette {
  bg: string;
  surface: string;
  fg: string;
  accent: string;
  muted: string;
  border: string;
}

const DEFAULT_PALETTE: DesignSystemPalette = {
  bg: '#fbfaf7',
  surface: '#ffffff',
  fg: '#1f1d1b',
  accent: '#d66f4d',
  muted: '#706b65',
  border: '#ddd8d0',
};

const FALLBACK_SLUG = 'custom-design-system';
const MAX_SLUG_LENGTH = 64;
const MAX_TITLE_LENGTH = 80;

export class DesignSystemStoreError extends Error {
  constructor(readonly code: 'invalid-title' | 'invalid-id' | 'not-found' | 'not-in-user-dir') {
    super(`design-system-store:${code}`);
    this.name = 'DesignSystemStoreError';
  }
}

/** '.' / '..' 与任何带分隔符的串都会被正则挡掉；放行前导点是 open-design 的口径。 */
export function isSafeDesignSystemId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

export function slugifyDesignSystemTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    // 中文标题转不出 ASCII，先塌成空格再走下面的折叠，避免整串被清空后拼出乱码目录
    .replace(/[^\x20-\x7e]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug || FALLBACK_SLUG;
}

export function normalizeHexColor(value: string | undefined, fallback: string): string {
  const matched = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec((value || '').trim());
  if (!matched) return fallback;
  const raw = matched[1];
  const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  return `#${hex.toLowerCase()}`;
}

function cleanMultiline(value: string | undefined, maxLength: number): string {
  const text = (value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return text;
}

/**
 * 九段式草稿正文（抄 open-design 的 buildDraftDesignSystemBody）。
 * Color 段用 `**Name** (\`#hex\`): role` 写法，正好命中 showcase 的 Pattern A，
 * 六个角色各自的 hint 都能被 pickColor 认出来，预览就不会退到猜色。
 */
export function buildDraftDesignMd(
  title: string,
  category: string,
  summary: string,
  palette: DesignSystemPalette,
): string {
  return `# ${title}

> Category: ${category}
> ${summary}

## 1. Visual Theme & Atmosphere

${summary}

Keep that mood on every surface: one accent colour does all the emphasising, whitespace is generous, and nothing is decorative for its own sake.

## 2. Color

- **Background** (\`${palette.bg}\`): Primary background.
- **Surface** (\`${palette.surface}\`): Card surface.
- **Foreground** (\`${palette.fg}\`): Primary text.
- **Accent** (\`${palette.accent}\`): Primary accent, reserved for the main call to action, active states and key data.
- **Muted** (\`${palette.muted}\`): Secondary text.
- **Border** (\`${palette.border}\`): Hairline border.

## 3. Typography

- Display: Fraunces, Playfair Display, Georgia, serif
- Body: Inter, system-ui, -apple-system, Segoe UI, sans-serif
- Mono: JetBrains Mono, ui-monospace, Menlo, monospace
- Scale: 12/14/16/20/28/40, tight tracking on display sizes only.

## 4. Spacing & Grid

- 8pt baseline grid; radius 12px for cards, 8px for controls.
- Keep vertical rhythm consistent across sections; avoid ad-hoc offsets.

## 5. Layout & Composition

- One dominant column per view, max width ~1120px, asymmetric margins over centred symmetry.
- Navigation stays quiet so content carries the hierarchy.

## 6. Components

- Buttons: accent fill for the primary action, hairline outline for everything else.
- Cards: surface + hairline border, no stacked shadows.
- Forms: label above field, inline validation, one column.

## 7. Motion & Interaction

- 140-220ms ease-out for state changes; motion explains a transition, never decorates it.
- Honour \`prefers-reduced-motion\`.

## 8. Voice & Brand

- Plain, declarative sentences. Verb-first labels on actions.
- No hype adjectives, no emoji in product copy.

## 9. Anti-patterns

- No gradient-painted headlines, no glassmorphism on every panel, no purple-to-blue AI default.
- No more than two typefaces, no more than one accent colour per view.
- Do not invent a second palette when this one is enough.
`;
}

export function buildDesignTokensCss(title: string, palette: DesignSystemPalette): string {
  return `/* ${title} — user-authored design tokens */

:root {
  --bg: ${palette.bg};
  --surface: ${palette.surface};
  --fg: ${palette.fg};
  --muted: ${palette.muted};
  --border: ${palette.border};
  --accent: ${palette.accent};
  --accent-on: ${palette.surface};
  --success: #16a34a;
  --warn: #d97706;
  --danger: #dc2626;
  --font-display: Fraunces, Playfair Display, Georgia, serif;
  --font-body: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
`;
}

export async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 裸 mkdir 抢注目录名：EEXIST 就往后加序号。两个并发创建各自拿到唯一目录，
 * 谁都不会覆盖谁（open-design 的 reserveUniqueSlugDirectory 同一手法）。
 */
async function reserveDesignSystemDir(rootDir: string, slug: string, taken: Set<string>): Promise<string> {
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0 ? slug : `${slug}-${index + 1}`;
    if (taken.has(candidate)) continue;
    try {
      await fs.mkdir(path.join(rootDir, candidate));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`design-system-store:slug-exhausted:${slug}`);
}

export async function listUserDesignSystemIds(userSystemsPath: string): Promise<string[]> {
  const dirs = await fs.readdir(userSystemsPath, { withFileTypes: true }).catch(() => []);
  return dirs.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
}

export async function createUserDesignSystem(
  userSystemsPath: string,
  input: CreateUserDesignSystemInput,
  reservedIds: Set<string>,
): Promise<CreatedDesignSystem> {
  const title = cleanMultiline(input.title, MAX_TITLE_LENGTH);
  if (!title) throw new DesignSystemStoreError('invalid-title');

  const category = cleanMultiline(input.category, 40) || 'Custom';
  const summary = cleanMultiline(input.summary, 400)
    || `A user-authored design system for ${title}.`;
  const palette: DesignSystemPalette = {
    ...DEFAULT_PALETTE,
    accent: normalizeHexColor(input.accentColor, DEFAULT_PALETTE.accent),
  };

  await fs.mkdir(userSystemsPath, { recursive: true });
  const taken = new Set([...reservedIds, ...(await listUserDesignSystemIds(userSystemsPath))]);
  const id = await reserveDesignSystemDir(userSystemsPath, slugifyDesignSystemTitle(title), taken);
  const systemDir = path.join(userSystemsPath, id);

  try {
    await fs.writeFile(path.join(systemDir, 'DESIGN.md'), buildDraftDesignMd(title, category, summary, palette), 'utf-8');
    await fs.writeFile(path.join(systemDir, 'tokens.css'), buildDesignTokensCss(title, palette), 'utf-8');
    await fs.writeFile(
      path.join(systemDir, 'manifest.json'),
      `${JSON.stringify({ id, name: title, category, description: summary, source: { type: 'user' } }, null, 2)}\n`,
      'utf-8',
    );
  } catch (err) {
    // 目录是自己抢注来的，回滚不会碰到同名并发赢家
    await fs.rm(systemDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  return { id, name: title, category, description: summary };
}

export async function deleteUserDesignSystem(userSystemsPath: string, systemId: string): Promise<void> {
  if (!isSafeDesignSystemId(systemId)) throw new DesignSystemStoreError('invalid-id');
  const userRoot = path.resolve(userSystemsPath);
  const systemDir = path.resolve(userRoot, systemId);
  if (!systemDir.startsWith(userRoot + path.sep)) throw new DesignSystemStoreError('not-in-user-dir');
  if (!(await directoryExists(systemDir))) throw new DesignSystemStoreError('not-found');
  await fs.rm(systemDir, { recursive: true, force: true });
}
