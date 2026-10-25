/**
 * 官方 GenUI 物料接入点（票 02）—— 沙箱里唯一 import OpenTiny SDK 的文件。
 *
 * 单独成文件有两个理由：官方渲染器在 jsdom 装不起来（依赖链上有模块导入期就摸 DOM），
 * 编排逻辑因此能留在 `src/lib/genui/cardRenderer.ts` 被 CI 钉住，这里只做胶水；
 * 换物料版本时改一个文件。
 *
 * 物料表按宿主同一份白名单过滤：官方 `miniMaterials.components` 其实带全量组件（含图表），
 * 不过一遍就等于沙箱什么都能画，白名单只剩宿主一侧生效。
 */
import { h } from 'vue'
import { GenuiRenderer } from '@opentiny/genui-sdk-vue/renderer'
import { GenuiConfigProvider } from '@opentiny/genui-sdk-vue/config-provider'
import { miniMaterials } from '@opentiny/genui-sdk-materials-vue-opentiny-vue/materials'
import { pickWhitelistedMaterials } from '@/shared/genuiMaterials'
import type { CardRenderContext } from '@/lib/genui/cardRenderer'
import { createSandboxCardActions } from './cardActionWiring'

const materials = {
  ...miniMaterials,
  // 类型上 components 是可选的；名单取空等于什么都注册不了，宁可显式取不到
  components: pickWhitelistedMaterials(miniMaterials.components ?? {}),
}

/** 主题与语言只从这里进渲染器：卡片读不到父窗口 CSS（ADR 0015 的推论）。 */
export function renderOfficialCard(context: CardRenderContext) {
  return h(
    GenuiConfigProvider,
    { theme: context.appearance.theme, locale: context.appearance.locale, materials },
    {
      default: () =>
        h(GenuiRenderer, {
          content: context.schema,
          isJsonComplete: true,
          // 卡片里的按钮走渲染器原生 callAction；接线只负责把参数规范化后发回宿主
          customActions: createSandboxCardActions((request) =>
            context.requestAction(request.action, request.payload),
          ),
        }, {
          // 渲染器把内部失败算在插槽的 isError 上，不抛异常；不接住就变成一张空白卡
          footer: (slotProps: { isError: boolean }) => {
            if (slotProps.isError) context.notifyFailure()
            return null
          },
        }),
    },
  )
}
