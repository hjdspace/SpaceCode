/**
 * 生成式 UI 技能的构建期生成器（票 07 第 1 条，口径见 ADR 0016 与 `docs/prd/genui-cards.md` §6）。
 *
 * 一份 `SKILL.md` 同时喂 Claude Code 与 Pi：正文里的物料与协议说明由 OpenTiny `genPrompt`
 * 基于**当前安装的**官方 mini 物料元数据生成，frontmatter 与输出契约手写。两个引擎读同一份文本，
 * 差异只在安装目录 —— 所以「给 Claude 单独写一份提示」在这个设计里是不存在的分支。
 *
 * 产物提交进仓库（`resources/builtin-skills/genui-card/SKILL.md`）而不是每次打包现生成：
 * `tests/genui-skill-artifact.test.ts` 会拿当前依赖重新生成一遍并与产物逐字比对，
 * 物料升级而未重新生成就在那里失败。主进程 seed 只读文件，不 import 本模块，
 * 于是渲染端 bundle 不会被 `genPrompt` 与 240KB 物料元数据污染。
 *
 * 官方正文与手写契约冲突时（典型：官方示例用 `Page` 根节点，SpaceCode 宿主只认物料白名单），
 * 以渲染端实际支持的协议为准，本节显式压过官方说法。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { genPrompt } from '@opentiny/genui-sdk-core'
import { miniMaterialsMeta } from '@opentiny/genui-sdk-materials-vue-opentiny-vue/meta'

import { GENUI_CARD_ACTIONS, GENUI_SANDBOX_PROTOCOL_VERSION } from '../src/shared/genuiSandbox'
import { GENUI_MATERIAL_WHITELIST } from '../src/shared/genuiMaterials'

/** 技能 id，同时也是资源目录名与 frontmatter 的 `name`（Claude 与 Pi 都按小写连字符取交集）。 */
export const GENUI_SKILL_ID = 'genui-card'

/** 随应用发布的内置技能资源目录；electron-builder 把 `resources/builtin-skills` 拷成 `builtin-skills`。 */
export const BUNDLED_SKILLS_RESOURCE_DIR = 'builtin-skills'

export const GENUI_SKILL_ARTIFACT_REL_PATH = `resources/${BUNDLED_SKILLS_RESOURCE_DIR}/${GENUI_SKILL_ID}/SKILL.md`

const CORE_PACKAGE = '@opentiny/genui-sdk-core'
const MATERIALS_PACKAGE = '@opentiny/genui-sdk-materials-vue-opentiny-vue'

/** 触发词写进 description：技能清单里只有这一行，模型靠它决定要不要加载正文。 */
const SKILL_DESCRIPTION =
  '生成 SpaceCode 聊天里可交互的卡片（Card Schema）。当用户要参数表单、筛选条件、选项确认、结构化信息展示，' +
  '或需要把填写结果提交回对话时使用。输出一个 schemaJson 代码块，SpaceCode 在隔离沙箱里渲染它；' +
  '卡片只能请求 submit、copy、expand、openLink 四个动作，不能访问网络或改动代码。' +
  'Generate an interactive SpaceCode chat card (Card Schema) for forms, filters, confirmations and structured display.'

/**
 * 沙箱暴露给卡片 CSS 的主题变量。写进正文是为了让模型「用这些名字」而不是自己编一个，
 * 事实来源是 `sandbox/sandbox.theme.css` 的 `:root` 声明块。
 */
const CARD_THEME_TOKENS: ReadonlyArray<readonly [string, string]> = [
  ['--card-fg', '正文前景色'],
  ['--card-muted', '次要文字、说明、标签'],
  ['--card-surface', '卡片底（TinyCard 已经用了它）'],
  ['--card-surface-inset', '比卡片底更低一层的内嵌块'],
  ['--card-border', '分隔线与描边'],
  ['--card-accent', '强调色：链接、关键数字、选中态'],
  ['--card-pass', '成功 / 通过'],
  ['--card-fail', '失败 / 危险'],
]

/** 官方 base rules 里与根节点无关、但仍然要紧的几条 —— SpaceCode 口径重写，所以由本节供给。 */
const SPACECODE_RULES = [
  '- 输出的 schemaJson 必须是严格 JSON：属性名带双引号、不使用单引号、最后一个属性后不加逗号、不允许注释',
  '- `children` 不能放进 `props`，它必须是数组或字符串',
  '- 单个组件节点可以用 `condition` 控制显示',
  '- 图片和链接地址不可杜撰，只使用上下文里真实给出的地址',
  '- 组件与属性只能取自下方「可用组件」与「卡片的 JSON Schema」，禁止臆造组件 API',
  // 视觉靠 css + className：渲染器支持根节点的 `css` 字段（postcss 作用域化后注入），
  // 这是卡片能不能看出"设计过"的唯一通道，所以这里从"禁止样式"改成"指定怎么加样式"。
  '- 排版与视觉用根节点的 `css` 字段配合各节点的 `props.className` 实现：把 class 写进 `css` 里定义间距、字号层级、栅格、圆角，再挂到节点上。只堆 `p` 与 `li` 的卡片等于没做卡片',
  '- 颜色一律取上面「主题变量」列出的 `var(--card-*)`，禁止硬编码十六进制色值与 `rgb()` 字面量：卡片要同时成立在明暗两套主题下',
  '- 禁止用 `css` 或行内样式改动宿主已经定好的东西：不要给 `.tiny-card` 与表单控件重新定义背景与边框',
  '- 禁止使用弹窗组件，逻辑里禁止 `alert`、`confirm`、`prompt`',
  '- 注意对话的连续性，不要重复渲染上下文里已经出现过的内容',
]

/** 四个动作的一句话说明，同时喂给 `genPrompt` 的 Action 定义与手写契约。 */
const ACTION_DOCS: Record<(typeof GENUI_CARD_ACTIONS)[number], string> = {
  submit:
    "`this.callAction('submit', { …表单值 })` —— 参数对象作为提交结果回到对话（进入模型上下文并随会话持久化）；卡片随之转为只读",
  copy: "`this.callAction('copy', '要复制的文本')` 或 `this.callAction('copy', { text: '…' })` —— 由宿主写剪贴板",
  expand: "`this.callAction('expand')` —— 请宿主展开这张卡",
  openLink:
    "`this.callAction('openLink', 'https://…')` 或 `this.callAction('openLink', { url: 'https://…' })` —— 只放行绝对 http/https 链接，由宿主用外部浏览器打开",
}

/** 契约正文用整句；`genPrompt` 的 Action 定义只要动作本身是什么。 */
function actionSummary(name: (typeof GENUI_CARD_ACTIONS)[number]): string {
  return ACTION_DOCS[name].split(' —— ')[1] ?? ACTION_DOCS[name]
}

function installedVersion(repoRoot: string, pkg: string): string {
  const raw = readFileSync(join(repoRoot, 'node_modules', pkg, 'package.json'), 'utf-8')
  return (JSON.parse(raw) as { version: string }).version
}

/** 仓库根，用于按当前安装的依赖取版本号 —— 生成的文本因此只依赖依赖与渲染端常量。 */
function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/** 生成正文：物料清单、JSON Schema、官方示例、snippets、this 上下文与 Action 定义。 */
function generatedBody(): string {
  return genPrompt(
    'Vue',
    miniMaterialsMeta,
    { customActions: GENUI_CARD_ACTIONS.map((name) => ({ name, description: actionSummary(name) })) },
    // includeBaseRules=false：官方那套 base rules 里两条把 `Page` 定为根节点，与 SpaceCode 宿主的
    // 物料白名单直接冲突；规则由上面的 SPACECODE_RULES 供给，`genPrompt` 仍然注入框架与物料自带规则。
    { isSkill: true, includeBaseRules: false, rules: SPACECODE_RULES },
  )
}

/**
 * 整篇技能正文。确定性输出：同样的依赖与同样的渲染端常量必然得到同样的文本，
 * 漂移测试因此可以直接比对全文。
 */
export function buildGenuiSkillMarkdown(root = defaultRepoRoot()): string {
  const core = installedVersion(root, CORE_PACKAGE)
  const materials = installedVersion(root, MATERIALS_PACKAGE)
  const rootComponents = GENUI_MATERIAL_WHITELIST.join(', ')
  const actions = GENUI_CARD_ACTIONS.join(', ')

  return `---
name: ${GENUI_SKILL_ID}
description: ${SKILL_DESCRIPTION}
---

<!--
  generated-by: scripts/genui-skill-build.mts
  regenerate: npm run build:genui-skill
  这一行以下由生成器产出，请勿手工编辑；手写契约也改这里。
  genui-sdk-core: ${core}
  genui-sdk-materials: ${materials}
  card-protocol-version: ${GENUI_SANDBOX_PROTOCOL_VERSION}
  allowed-actions: ${actions}
  root-components: ${rootComponents}
-->

# SpaceCode 生成式 UI 卡片

你有一项技能：把一段 \`schemaJson\` 交给 SpaceCode，SpaceCode 在**对话里**把它渲染成一张可交互卡片。
卡片跑在隔离沙箱 iframe 内，没有网络、没有应用权限，只能通过下面列出的四个动作请宿主做事。

## 输出契约（最高优先级）

下面「官方物料与协议说明」由 OpenTiny GenUI SDK 生成，用来告诉你有哪些组件与字段可用；
一旦与本节冲突，**以本节为准**。

1. **只输出 \`\`\`schemaJson 围栏代码块**，一块一张卡。围栏的语言标记固定是 \`schemaJson\`，不要写成 \`json\`；围栏里是严格 JSON。
2. **围栏之外不写解释性散文**：不要说「下面是你的表单」、不要复述卡片内容、不要在围栏后补充说明。
   需要解释的话写在卡片里。普通文本回答（不成卡的回答）不受这条约束。
3. **根节点写 \`div\`。** 渲染器把根节点当「页面容器」处理：不管 \`componentName\` 写什么，画出来都是一个
   \`div\`，\`props\` 会被漏成 DOM 属性 —— 所以根节点写 \`TinyCard\` 的卡没有卡底，写 \`TinyForm\` 的卡
   连表单项都出不来。要卡片外壳或表单，就把 \`TinyCard\` / \`TinyForm\` 放进根节点的 \`children\`。
   \`Page\` 同样不能当根节点：SpaceCode 不接受 \`Page\` 作为根节点
   （官方 JSON Schema 的字段描述与示例里那个「通常为 Page」的根节点在 SpaceCode 里会退化成代码块）。
4. 白名单（与 SpaceCode 渲染端同源）：\`${GENUI_MATERIAL_WHITELIST.join('`, `')}\`
5. 卡片可请求的宿主动作只有四个，用 \`this.callAction(name, params)\` 调用：
${GENUI_CARD_ACTIONS.map((name) => `   - ${ACTION_DOCS[name]}`).join('\n')}
   其它动作名（包括官方示例里出现的 \`continueChat\`、\`saveState\`）在 SpaceCode 中不存在，调用会被宿主丢弃。
6. 禁止事项：不得请求网络、不得加载远程图片/字体/脚本、不得执行命令、不得读写或修改文件与代码、
   不得访问宿主的应用能力。卡片做不到的事就用 \`submit\` 把意图交回对话。
7. 不要自己加 \`protocolVersion\` 之类的字段：卡片协议里节点是封闭的，版本判定由宿主完成。
   本技能对应 SpaceCode 卡片协议 v${GENUI_SANDBOX_PROTOCOL_VERSION}；协议不匹配时宿主把卡片降级成文本。
8. 一条消息最多 8 张卡、单张 schema 不超过 64KB；超出的卡片不会被渲染。
9. 表单输入项（\`TinyInput\` / \`TinySelect\` / \`TinyRadioGroup\` / \`TinyCheckboxGroup\` / \`TinySwitch\` / \`TinyDatePicker\`）
   必须双向绑定到 \`state\`：\`modelValue\` 用 \`{ "type": "JSExpression", "model": true, "value": "this.state.xxx" }\`，
   \`submit\` 时把这些值作为参数对象交回。
10. 下面官方物料说明里的**整例**是为通用 GenUI 写的：它们的根节点是 \`Page\`，还带 \`Img\` 这类
    不在白名单内的组件与远程图片地址。只借用其中的字段与事件写法，最外层换成 \`div\`，
    远程地址一律去掉。
11. 样式写在根节点的 \`css\` 字段里（一段 CSS 文本，会被作用域化后注入本卡），再用各节点的
    \`props.className\` 挂上去。\`css\` 与 \`className\` 是同级字段，不要塞进 \`props\`。

## 主题变量

\`css\` 里能且只能引用这些变量 —— 沙箱按宿主当前主题切换它们的值，硬编码色值在另一套主题下就会看不见：

${CARD_THEME_TOKENS.map(([name, purpose]) => '- \`${name}\` —— ${purpose}').join('\n')}

字号与间距建议以 4px 为步长（4 / 8 / 12 / 16 / 24），一屏最多两档字号差；卡片整体已经由宿主给了
内边距与圆角，\`css\` 只管卡片内部的排布。

## 最小卡片示例

\`\`\`schemaJson
{
  "componentName": "div",
  "state": { "env": "prod" },
  "methods": {},
  "children": [
    {
      "componentName": "TinyCard",
      "children": [
        { "componentName": "h4", "children": "部署参数" },
        {
          "componentName": "TinySelect",
          "props": {
            "placeholder": "请选择环境",
            "modelValue": { "type": "JSExpression", "model": true, "value": "this.state.env" },
            "options": [
              { "value": "prod", "label": "生产" },
              { "value": "stg", "label": "预发" }
            ]
          }
        },
        {
          "componentName": "TinyButton",
          "props": {
            "type": "primary",
            "onClick": {
              "type": "JSFunction",
              "value": "function() { this.callAction('submit', { env: this.state.env }); }"
            }
          },
          "children": "提交"
        }
      ]
    }
  ]
}
\`\`\`

## 排版示例（展示型卡片照这个做）

信息密度高的回答不要退化成 \`p\` + \`ul\`：用 \`css\` 做出层级 —— 关键数字放大、次要信息转弱、
并列项排成栅格。下面这张卡没有用任何白名单之外的组件。

\`\`\`schemaJson
{
  "componentName": "div",
  "css": ".hd{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}.sub{color:var(--card-muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}.cell{padding:10px 12px;border:1px solid var(--card-border);border-radius:10px;background:var(--card-surface-inset)}.num{font-size:22px;font-weight:650;line-height:1.2;color:var(--card-accent)}.cap{font-size:11px;color:var(--card-muted);letter-spacing:.04em}.note{margin:0;font-size:12px;color:var(--card-muted)}",
  "children": [
    {
      "componentName": "TinyCard",
      "children": [
        {
          "componentName": "div",
          "props": { "className": "hd" },
          "children": [
            { "componentName": "h3", "children": "西安天气" },
            { "componentName": "span", "props": { "className": "sub" }, "children": "2026-10-26 · 阴" }
          ]
        },
        {
          "componentName": "div",
          "props": { "className": "grid" },
          "children": [
            { "componentName": "div", "props": { "className": "cell" }, "children": [
              { "componentName": "div", "props": { "className": "num" }, "children": "14°C" },
              { "componentName": "div", "props": { "className": "cap" }, "children": "当前 · 体感 9°C" }
            ]},
            { "componentName": "div", "props": { "className": "cell" }, "children": [
              { "componentName": "div", "props": { "className": "num" }, "children": "52%" },
              { "componentName": "div", "props": { "className": "cap" }, "children": "湿度" }
            ]},
            { "componentName": "div", "props": { "className": "cell" }, "children": [
              { "componentName": "div", "props": { "className": "num" }, "children": "17" },
              { "componentName": "div", "props": { "className": "cap" }, "children": "km/h 西南偏西" }
            ]}
          ]
        },
        { "componentName": "p", "props": { "className": "note" }, "children": "午间偶有零星小雨，傍晚转烟霾。" },
        {
          "componentName": "TinyButton",
          "props": {
            "onClick": { "type": "JSFunction", "value": "function() { this.callAction('copy', '西安 阴 14°C，湿度 52%'); }" }
          },
          "children": "复制摘要"
        }
      ]
    }
  ]
}
\`\`\`

## 官方物料与协议说明

${generatedBody()}

## 重申

上面是官方物料手册，篇幅长、例子多；真正决定这张卡能不能渲染、好不好看的是这五条：

1. 只输出 \`\`\`schemaJson 围栏，围栏之外不写解释性散文。
2. 根 \`componentName\` 写 \`div\`，把 \`TinyCard\` / \`TinyForm\` 放进它的 \`children\`，**不要用 \`Page\`**。
3. 动作只有 \`submit\` / \`copy\` / \`expand\` / \`openLink\`；要把结果交回对话就用 \`submit\`。
4. 卡片的样子靠根节点的 \`css\` 配 \`props.className\` 做，颜色只用 \`var(--card-*)\`：只堆纯文本不算做了卡片。
5. 沙箱没有网络、没有文件与命令权限：不要写远程资源地址，不要试图改动代码。
`
}

/**
 * 生成并写入产物，返回写入路径与正文。正文没变就不落盘：
 * git 在 Windows 上按 `core.autocrlf` 把这份产物检出成 CRLF，而生成器只产 LF，
 * 每跑一次 build 都重写会把行尾改回 LF，`git status` 里就出现整文件换行差异。
 */
export async function generateGenuiSkill(
  root = defaultRepoRoot(),
): Promise<{ path: string; markdown: string; written: boolean }> {
  const markdown = buildGenuiSkillMarkdown(root)
  const path = join(root, GENUI_SKILL_ARTIFACT_REL_PATH)
  const existing = await readFile(path, 'utf-8').catch(() => undefined)
  if (existing?.replace(/\r\n/g, '\n') === markdown) {
    return { path, markdown, written: false }
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, markdown, 'utf-8')
  return { path, markdown, written: true }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { path, written } = await generateGenuiSkill()
  console.log(`[genui-skill] ${written ? 'generated' : 'unchanged'} -> ${path}`)
}
