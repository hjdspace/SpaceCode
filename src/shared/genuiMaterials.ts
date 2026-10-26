/**
 * 生成式 UI 卡片的物料白名单（宿主与沙箱共用一份）。
 *
 * 事实来源是官方 mini 物料元数据 `@opentiny/genui-sdk-materials-vue-opentiny-vue/meta` 的
 * `whiteList`；这里手抄一份常量而不是运行时读它，因为主窗口只为一条名单不值得打包 240KB 的
 * 元数据。漂移由 `__tests__/genuiMaterials.test.ts` 直接对拼官方元数据钉住（口径见
 * `docs/prd/genui-cards.md` §6「漂移由测试钉住」）。
 *
 * 名单里同时含 HTML 标签名与 TinyVue 组件名：前者由渲染器内建，后者需要注册进物料表。
 */
export const GENUI_MATERIAL_WHITELIST: readonly string[] = Object.freeze([
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ol',
  'ul',
  'li',
  'div',
  'img',
  'input',
  'video',
  'label',
  'Text',
  'TinyIcon',
  'TinyForm',
  'TinyFormItem',
  'TinyButton',
  'TinyInput',
  'TinyRadio',
  'TinyRadioGroup',
  'TinySelect',
  'TinySwitch',
  'TinyNumeric',
  'TinyCheckbox',
  'TinyCheckboxButton',
  'TinyCheckboxGroup',
  'TinyDatePicker',
  'TinyGrid',
  'TinyCard',
])

const WHITELIST_LOOKUP = new Set(GENUI_MATERIAL_WHITELIST)

/**
 * 组件名是否可用。用 Set 判定而不是 `in`，否则 `constructor` / `__proto__`
 * 这类原型链上的键会被误判成白名单组件。
 */
export function isGenuiComponentAllowed(componentName: unknown): componentName is string {
  return typeof componentName === 'string' && WHITELIST_LOOKUP.has(componentName)
}

/**
 * 从物料表里只挑白名单内的组件，顺序按白名单。
 *
 * 官方 `miniMaterials.components` 带的是**全量**组件表（含 12 个图表）—— mini 收窄的是
 * schema/prompt 面，不是注册面。沙箱注册前再过一遍这份名单，才真正做到「只认 mini 物料」；
 * 宿主投影用的是同一个名单，不会出现「宿主放行、沙箱画不出来」。
 */
export function pickWhitelistedMaterials<T>(components: Record<string, T>): Record<string, T> {
  const picked: Record<string, T> = {}
  for (const name of GENUI_MATERIAL_WHITELIST) {
    // 名单里的 HTML 标签名（a / p / div…）由渲染器内建，物料表里没有，跳过即可
    if (Object.prototype.hasOwnProperty.call(components, name)) picked[name] = components[name]
  }
  return picked
}
