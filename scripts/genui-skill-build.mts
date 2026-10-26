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
import { mkdir, writeFile } from 'node:fs/promises'
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

/** 官方 base rules 里与根节点无关、但仍然要紧的几条 —— SpaceCode 口径重写，所以由本节供给。 */
const SPACECODE_RULES = [
  '- 输出的 schemaJson 必须是严格 JSON：属性名带双引号、不使用单引号、最后一个属性后不加逗号、不允许注释',
  '- `children` 不能放进 `props`，它必须是数组或字符串',
  '- 单个组件节点可以用 `condition` 控制显示',
  '- 图片和链接地址不可杜撰，只使用上下文里真实给出的地址',
  '- 组件与属性只能取自下方「可用组件」与「卡片的 JSON Schema」，禁止臆造组件 API',
  '- 禁止设置任何组件的 `background`、`color`、`background-color` 等颜色 CSS 样式；卡片跟随 SpaceCode 明暗主题',
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
3. **根节点的 \`componentName\` 必须是下面白名单里的组件。** SpaceCode 不接受 \`Page\` 作为根节点
   （官方 JSON Schema 的字段描述与示例里那个「通常为 Page」的根节点在 SpaceCode 里会退化成代码块）；
   表单用 \`TinyForm\`，带标题的展示块用 \`TinyCard\`，纯布局用 \`div\`，纯文本用 \`p\` 或 \`Text\`。
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
    不在白名单内的组件与远程图片地址。只借用其中的字段与事件写法，最外层换成白名单组件，
    远程地址一律去掉。

## 最小卡片示例

\`\`\`schemaJson
{
  "componentName": "TinyCard",
  "state": { "env": "prod" },
  "methods": {},
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
        "text": "提交",
        "onClick": {
          "type": "JSFunction",
          "value": "function() { this.callAction('submit', { env: this.state.env }); }"
        }
      }
    }
  ]
}
\`\`\`

## 官方物料与协议说明

${generatedBody()}

## 重申

上面是官方物料手册，篇幅长、例子多；真正决定这张卡能不能渲染出来的是这四条：

1. 只输出 \`\`\`schemaJson 围栏，围栏之外不写解释性散文。
2. 根 \`componentName\` 取自白名单（\`TinyForm\` / \`TinyCard\` / \`div\` / \`p\` …），**不要用 \`Page\`**。
3. 动作只有 \`submit\` / \`copy\` / \`expand\` / \`openLink\`；要把结果交回对话就用 \`submit\`。
4. 沙箱没有网络、没有文件与命令权限：不要写远程资源地址，不要试图改动代码。
`
}

/** 生成并写入产物，返回写入路径与正文。 */
export async function generateGenuiSkill(root = defaultRepoRoot()): Promise<{ path: string; markdown: string }> {
  const markdown = buildGenuiSkillMarkdown(root)
  const path = join(root, GENUI_SKILL_ARTIFACT_REL_PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, markdown, 'utf-8')
  return { path, markdown }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { path } = await generateGenuiSkill()
  console.log(`[genui-skill] generated -> ${path}`)
}
