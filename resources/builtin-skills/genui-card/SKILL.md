---
name: genui-card
description: 生成 SpaceCode 聊天里可交互的卡片（Card Schema）。当用户要参数表单、筛选条件、选项确认、结构化信息展示，或需要把填写结果提交回对话时使用。输出一个 schemaJson 代码块，SpaceCode 在隔离沙箱里渲染它；卡片只能请求 submit、copy、expand、openLink 四个动作，不能访问网络或改动代码。Generate an interactive SpaceCode chat card (Card Schema) for forms, filters, confirmations and structured display.
---

<!--
  generated-by: scripts/genui-skill-build.mts
  regenerate: npm run build:genui-skill
  这一行以下由生成器产出，请勿手工编辑；手写契约也改这里。
  genui-sdk-core: 1.4.0
  genui-sdk-materials: 1.4.0
  card-protocol-version: 1
  allowed-actions: submit, copy, expand, openLink
  root-components: a, h1, h2, h3, h4, h5, h6, p, ol, ul, li, div, img, input, video, label, Text, TinyIcon, TinyForm, TinyFormItem, TinyButton, TinyInput, TinyRadio, TinyRadioGroup, TinySelect, TinySwitch, TinyNumeric, TinyCheckbox, TinyCheckboxButton, TinyCheckboxGroup, TinyDatePicker, TinyGrid, TinyCard
-->

# SpaceCode 生成式 UI 卡片

你有一项技能：把一段 `schemaJson` 交给 SpaceCode，SpaceCode 在**对话里**把它渲染成一张可交互卡片。
卡片跑在隔离沙箱 iframe 内，没有网络、没有应用权限，只能通过下面列出的四个动作请宿主做事。

## 输出契约（最高优先级）

下面「官方物料与协议说明」由 OpenTiny GenUI SDK 生成，用来告诉你有哪些组件与字段可用；
一旦与本节冲突，**以本节为准**。

1. **只输出 ```schemaJson 围栏代码块**，一块一张卡。围栏的语言标记固定是 `schemaJson`，不要写成 `json`；围栏里是严格 JSON。
2. **围栏之外不写解释性散文**：不要说「下面是你的表单」、不要复述卡片内容、不要在围栏后补充说明。
   需要解释的话写在卡片里。普通文本回答（不成卡的回答）不受这条约束。
3. **根节点的 `componentName` 必须是下面白名单里的组件。** SpaceCode 不接受 `Page` 作为根节点
   （官方 JSON Schema 的字段描述与示例里那个「通常为 Page」的根节点在 SpaceCode 里会退化成代码块）；
   表单用 `TinyForm`，带标题的展示块用 `TinyCard`，纯布局用 `div`，纯文本用 `p` 或 `Text`。
4. 白名单（与 SpaceCode 渲染端同源）：`a`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `p`, `ol`, `ul`, `li`, `div`, `img`, `input`, `video`, `label`, `Text`, `TinyIcon`, `TinyForm`, `TinyFormItem`, `TinyButton`, `TinyInput`, `TinyRadio`, `TinyRadioGroup`, `TinySelect`, `TinySwitch`, `TinyNumeric`, `TinyCheckbox`, `TinyCheckboxButton`, `TinyCheckboxGroup`, `TinyDatePicker`, `TinyGrid`, `TinyCard`
5. 卡片可请求的宿主动作只有四个，用 `this.callAction(name, params)` 调用：
   - `this.callAction('submit', { …表单值 })` —— 参数对象作为提交结果回到对话（进入模型上下文并随会话持久化）；卡片随之转为只读
   - `this.callAction('copy', '要复制的文本')` 或 `this.callAction('copy', { text: '…' })` —— 由宿主写剪贴板
   - `this.callAction('expand')` —— 请宿主展开这张卡
   - `this.callAction('openLink', 'https://…')` 或 `this.callAction('openLink', { url: 'https://…' })` —— 只放行绝对 http/https 链接，由宿主用外部浏览器打开
   其它动作名（包括官方示例里出现的 `continueChat`、`saveState`）在 SpaceCode 中不存在，调用会被宿主丢弃。
6. 禁止事项：不得请求网络、不得加载远程图片/字体/脚本、不得执行命令、不得读写或修改文件与代码、
   不得访问宿主的应用能力。卡片做不到的事就用 `submit` 把意图交回对话。
7. 不要自己加 `protocolVersion` 之类的字段：卡片协议里节点是封闭的，版本判定由宿主完成。
   本技能对应 SpaceCode 卡片协议 v1；协议不匹配时宿主把卡片降级成文本。
8. 一条消息最多 8 张卡、单张 schema 不超过 64KB；超出的卡片不会被渲染。
9. 表单输入项（`TinyInput` / `TinySelect` / `TinyRadioGroup` / `TinyCheckboxGroup` / `TinySwitch` / `TinyDatePicker`）
   必须双向绑定到 `state`：`modelValue` 用 `{ "type": "JSExpression", "model": true, "value": "this.state.xxx" }`，
   `submit` 时把这些值作为参数对象交回。
10. 下面官方物料说明里的**整例**是为通用 GenUI 写的：它们的根节点是 `Page`，还带 `Img` 这类
    不在白名单内的组件与远程图片地址。只借用其中的字段与事件写法，最外层换成白名单组件，
    远程地址一律去掉。

## 最小卡片示例

```schemaJson
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
```

## 官方物料与协议说明

# 技能说明

你有一项技能，可用于生成可交互的 UI 界面。请结合上下文，如果需要生成界面来显示信息或收集信息，请生成对应的 schemaJson。


## 可用组件

必须使用以下支持的 componentName：`a`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `p`, `ol`, `ul`, `li`, `div`, `img`, `input`, `video`, `label`, `Text`, `TinyIcon`, `TinyForm`, `TinyFormItem`, `TinyButton`, `TinyInput`, `TinyRadio`, `TinyRadioGroup`, `TinySelect`, `TinySwitch`, `TinyNumeric`, `TinyCheckbox`, `TinyCheckboxButton`, `TinyCheckboxGroup`, `TinyDatePicker`, `TinyGrid`, `TinyCard`

具体组件的上下文如下，包含组件的配置信息：

```json
[{"name":"提示框","component":"a","description":"链接","schema":{"properties":[{"property":"children","description":"类型"},{"property":"href","description":"指定链接的 URL"},{"property":"target","description":"指定链接的打开方式，例如在当前窗口中打开或在新窗口中打开。"},{"property":"attributes3","description":"原生属性"}],"events":{},"slots":{}}},{"name":"段落","component":"p","description":"段落","schema":{"properties":[{"property":"children","description":"类型"},{"property":"attributes3","description":"原生属性"}],"events":[],"slots":{}}},{"name":"输入框","component":"input","description":"输入框","schema":{"properties":[{"property":"type","description":"类型"},{"property":"placeholder","description":"占位符"},{"property":"attributes3","description":"原生属性"}],"events":[{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onChange","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 输入值改变时触发"}],"slots":{}}},{"name":"视频","component":"video","description":"视频","schema":{"properties":[{"property":"src","description":"视频的 URL"},{"property":"width","description":"视频播放器的宽度"},{"property":"height","description":"视频播放器的高度"},{"property":"controls","description":"是否显示控件"},{"property":"autoplay","description":"是否马上播放"},{"property":"attributes3","description":"原生属性"}],"events":[],"slots":{}}},{"name":"表单","component":"TinyForm","description":"由按钮、输入框、选择器、单选框、多选框等控件组成，用以收集、校验、提交数据","schema":{"properties":[{"property":"disabled","description":"是否禁用"},{"property":"labelWidth","description":"表单中标签占位宽度，默认为 80px"},{"property":"inline","description":"行内布局模式，默认为 false"},{"property":"labelAlign","description":"必填标识 * 是否占位"},{"property":"labelSuffix","description":"表单中标签后缀"},{"property":"labelPosition","description":"表单中标签的布局位置"},{"property":"model","description":"表单数据对象"},{"property":"rules","description":"表单验证规则"},{"property":"validateOnRuleChange","description":"校验规则变化时触发校验","defaultValue":false}],"events":[{"event":"onValidate","functionInfo":{"params":[{"name":"function","type":"Function","description":{"zh_CN":"校验回调函数"}}],"returns":{}},"description":"表单项被校验后触发"},{"event":"onInput","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框输入的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onClear","functionInfo":{"params":[],"returns":{}},"description":"点击清空按钮时触发"}],"slots":{}}},{"name":"表单项","component":"TinyFormItem","description":"由按钮、输入框、选择器、单选框、多选框等控件组成，用以收集、校验、提交数据, 必须放在 TinyForm 中使用， 可以是直接子元素或者间接子元素","schema":{"properties":[{"property":"label","description":"标签文本"},{"property":"prop","description":"表单域 model 字段，在使用 validate、resetFields 方法的情况下，该属性是必填的"},{"property":"required","description":"是否必填"}],"events":[],"slots":[{"event":"label","description":"自定义显示字段名称"}]}},{"name":"按钮","component":"TinyButton","description":"常用的操作按钮，提供包括默认按钮、图标按钮、图片按钮、下拉按钮等类型","schema":{"properties":[{"property":"text","description":"按钮文字","type":"string"},{"property":"size","description":"按钮大小","type":"select"},{"property":"disabled","description":"是否被禁用"},{"property":"type","description":"设置不同的主题样式"},{"property":"icon","description":"按钮图标，必须使用 JSSlot 包裹 TinyIcon。正确示例：{\"type\":\"JSSlot\",\"value\":[{\"componentName\":\"TinyIcon\",\"props\":{\"name\":\"IconSearch\"}}]}。禁止直接传组件对象或使用 JSExpression。","type":"object"},{"property":"round","description":"是否圆角按钮"},{"property":"plain","description":"是否为朴素按钮"},{"property":"reset-time","description":"设置禁用时间，防止重复提交，单位毫秒"},{"property":"circle","description":"是否圆形按钮"},{"property":"autofocus","description":"是否默认聚焦"},{"property":"loading","description":"是否展示位加载中样式"}],"events":[{"event":"onClick","functionInfo":{"params":[],"returns":{}},"description":"按钮被点击时触发的回调函数"}],"slots":{}}},{"name":"输入框","component":"TinyInput","description":"通过鼠标或键盘输入字符","schema":{"properties":[{"property":"modelValue","description":"双向绑定值","defaultValue":""},{"property":"type","description":"设置input框的type属性"},{"property":"rows","description":"输入框行数，只对 type='textarea' 有效"},{"property":"placeholder","description":"输入框占位文本"},{"property":"clearable","description":"是否显示清除按钮"},{"property":"disabled","description":"是否禁用"},{"property":"size","description":"输入框尺寸。该属性的可选值为： medium 、small 、 mini"},{"property":"maxlength","description":"设置 input 框的maxLength"},{"property":"autofocus","description":"自动获取焦点"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框改变后的值"}}],"returns":{}},"description":"在 Input 值改变时触发"},{"event":"onInput","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框输入的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onClear","functionInfo":{"params":[],"returns":{}},"description":"点击清空按钮时触发"}],"slots":[{"event":"prefix","description":"前置内容"},{"event":"suffix","description":"后置内容"}]}},{"name":"单选","component":"TinyRadio","description":"用于配置不同场景的选项，在一组备选项中进行单选","schema":{"properties":[{"property":"text","description":"单选框文本内容"},{"property":"label","description":"radio 选中时的值"},{"property":"modelValue","description":"双向绑定的当前选中值","defaultValue":""},{"property":"disabled","description":"是否禁用"},{"property":"border","description":"是否显示边框"},{"property":"size","description":"单选框的尺寸，仅在 border 为true时有效"},{"property":"name","description":"原生 name 属性"}],"events":[{"event":"onChange","description":"绑定值变化时触发的事件"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的当前选中值"}}],"returns":{}},"description":"当前选中的值改变时触发"}],"slots":{}}},{"name":"单选按钮组","component":"TinyRadioGroup","description":"用于在一组选项中进行单选。","schema":{"properties":[{"property":"modelValue","description":"单选框组的绑定值","defaultValue":""},{"property":"options","description":"单选按钮选项列表，配置单选组的值、文本和点击事件。示例：[{label: '1', text: '选项1', events: {click: () => {console.log('点击选项1')}}}]","defaultValue":[]},{"property":"disabled","description":"是否禁用整个单选组"},{"property":"type","description":"单选组的展示形式,可选值为：radio(单选框) 、 button(按钮、选项式)"},{"property":"size","description":"单选组尺寸, 可选值有 medium 、 small 、 mini"},{"property":"vertical","description":"是否垂直展示单选按钮"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","defaultValue":"","description":{"zh_CN":"当前选中的值"}}],"returns":{}},"description":"选中值变化时触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","defaultValue":"","description":{"zh_CN":"更新后的绑定值"}}],"returns":{}},"description":"v-model 对应的值更新时触发"}],"slots":{}}},{"name":"下拉框","component":"TinySelect","description":"Select 选择器是一种通过点击弹出下拉列表展示数据并进行选择的 UI 组件","schema":{"properties":[{"property":"modelValue","description":"双向绑定的当前选中值","defaultValue":""},{"property":"placeholder","description":"输入框占位文本"},{"property":"clearable","description":"是否显示清除按钮"},{"property":"searchable","description":"下拉面板是否可搜索"},{"property":"disabled","description":"是否禁用"},{"property":"options","description":"配置 Select 下拉数据项","defaultValue":[]},{"property":"tooltipConfig","description":"悬浮提示配置，默认不显示","defaultValue":{"always":false}},{"property":"multiple","description":"是否允许输入框输入或选择多个项"},{"property":"multiple-limit","description":"多选时用户最多可以选择的项目数，为 0 则不限制"},{"property":"popper-class","description":"设置下拉框自定义的类名"},{"property":"collapse-tags","description":"多选时是否将选中值按文字的形式展示"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"下拉框选中项的值"}}],"returns":{}},"description":"在下拉框值改变时触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的当前选中值"}}],"returns":{}},"description":"当前选中的值改变时触发"},{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onClear","functionInfo":{"params":[],"returns":{}},"description":"点击清空按钮时触发"},{"event":"onRemoveTag","functionInfo":{"params":[{"name":"value","type":"Object","description":{"zh_CN":"被移除Tag对应数据项的值字段"}}],"returns":{}},"description":"多选模式下移除tag时触发"}],"slots":{}}},{"name":"开关","component":"TinySwitch","description":"Switch 在两种状态间切换选择","schema":{"properties":[{"property":"disabled","description":"是否被禁用"},{"property":"modelValue","description":"绑定默认值","defaultValue":false},{"property":"true-value","description":"设置打开时的值，类型为：Boolean | String | Number"},{"property":"false-value","description":"设置关闭时的值，类型为：Boolean | String | Number"},{"property":"mini","description":"是否显示为 mini 模式"}],"events":[{"event":"onChange","functionInfo":{"params":[],"returns":{}},"description":"按钮被点击时触发的回调函数"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的开关状态值"}}],"returns":{}},"description":"开关的状态值改变时触发"}],"slots":{}}},{"name":"复选框","component":"TinyCheckbox","description":"用于配置不同场景的选项，提供用户可在一组选项中进行多选","schema":{"properties":[{"property":"modelValue","description":"双向绑定值","defaultValue":false},{"property":"disabled","description":"是否禁用"},{"property":"checked","description":"当前是否勾选"},{"property":"text","description":"复选框的文本"},{"property":"border","description":"是否显示边框"},{"property":"false-label","description":"没有选中时的值"},{"property":"true-label","description":"选中时的值"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"选中项的值"}}],"returns":{}},"description":"勾选值改变后将触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的当前选中值"}}],"returns":{}},"description":"当前选中的值改变时触发"}],"slots":{}}},{"name":"复选按钮","component":"TinyCheckboxButton","description":"用于配置不同场景的选项，提供用户可在一组选项中进行多选","schema":{"properties":[{"property":"modelValue","description":"双向绑定的当前选中值","defaultValue":false},{"property":"disabled","description":"是否禁用"},{"property":"checked","description":"当前是否勾选"},{"property":"text","description":"按钮文本"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"选中项的值"}}],"returns":{}},"description":"勾选值改变后将触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"array","description":{"zh_CN":"双向绑定的当前选中值"}}],"returns":{}},"description":"当前选中的值改变时触发"}],"slots":{}}},{"name":"复选按钮组","component":"TinyCheckboxGroup","description":"用于配置不同场景的选项，提供用户可在一组选项中进行多选","schema":{"properties":[{"property":"modelValue","description":"双向绑定的当前选中值","defaultValue":[]},{"property":"disabled","description":"是否禁用"},{"property":"options","description":"checkbox组件列表"},{"property":"type","description":"checkbox组件类型（button/checkbox），该属性的默认值为 checkbox,配合 options 属性一起使用"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"选中项的值"}}],"returns":{}},"description":"勾选值改变后将触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"array","description":{"zh_CN":"双向绑定的当前选中值"}}],"returns":{}},"description":"当前选中的值改变时触发"}],"slots":{}}},{"name":"表格","component":"TinyGrid","description":"提供了非常强大数据表格功能，可以展示数据列表，可以对数据列表进行选择、编辑等","schema":{"properties":[{"property":"data","description":"设置表格的数据（静态数据）。与 fetchData 互斥，配置其一即可"},{"property":"columns","description":"表格列配置，需优先于 data 生成。列常用字段：title/field/width/type/sortable/showOverflow","properties":[{"property":"title","description":"列标题","type":"string"},{"property":"field","description":"列对应的数据字段名","type":"string"},{"property":"sortable","description":"该列是否可排序，默认 false","type":"boolean"},{"property":"width","description":"列宽，可为整数、px、%、auto","type":"string"},{"property":"formatText","description":"内置渲染器","type":"string"},{"property":"renderer","description":"列渲染配置函数，自定义渲染内容，优先级高于formatText","type":"object"},{"property":"slots","description":"插槽配置信息，可以配置多个插槽，比如：header、default等, 参数有row(行数据)，column(列数据)，$table(内部表格实例)，seq(序号)，cell(单元格)，columnIndex(列索引)，$rowIndex(行索引)， 需要在params数组声明后使用，使用时直接使用变量即可","type":"object"},{"property":"type","description":"内置列类型：index（序号）、selection（复选）、radio（单选）、expand（展开行）、operation（操作列）"},{"property":"editor","description":"单元格编辑渲染配置项，也可以是函数 Function(h, params)"},{"property":"filter","description":"设置表格列的筛选配置信息。默认值为 false 不配置筛选信息"},{"property":"showOverflow","description":"设置内置列的内容超出部分显示省略号配置，该属性的可选值为： ellipsis(只显示省略号） 、 title(显示为原生 title) 、 tooltip(显示为 tooltip 提示）"}]},{"property":"fetchData","description":"服务端数据查询方法，如 { api: () => Promise }。与 data 互斥，需配合 pager 使用"},{"property":"pager","description":"分页配置，需结合 fetchData。写法如 { attrs: { currentPage 当前页, pageSize 每页条数, pageSizes 可选每页条数数组, total 总条数, layout 布局如 \"total, prev, pager, next, jumper\" } }"},{"property":"resizable","description":"是否允许调整列宽，默认 true"},{"property":"row-id","description":"自定义行数据唯一主键字段名（默认 _RID，行数据需有唯一主键，默认自动生成）"},{"property":"select-config","description":"行复选框配置，需配合列 type=selection。常用字段：trigger 勾选触发方式（cell 点单元格 / row 点整行，默认点复选框图标）；labelField 复选框旁显示的字段名；checkRowKeys 初始化默认勾选的行主键数组（依赖 row-id）；checkMethod函数配置是否可选 返回 false 则该行不可勾选；checkAll 初始化是否全选；showHeader 表头是否显示全选框；"},{"property":"edit-rules","description":"编辑校验规则，配合 edit-config 与列 editor 使用。按字段名配置规则数组，如 { name: [{ required: true, message: \"必填\" }, { min: 2, max: 10, message: \"长度 2-10\" }] }"},{"property":"edit-config","description":"表格编辑配置。常用字段：trigger 激活方式（click / dblclick / manual）；mode 编辑粒度（cell 单元格 / row 整行）；showStatus 是否显示编辑状态标记；activeMethod({row, column}) 返回 false 则禁止编辑该单元格/行"},{"property":"expand-config","description":"展开行配置，需配合列 type=expand。常用字段：expandAll 是否默认展开全部；trigger 展开触发方式（default 点图标 / cell 点单元格 / row 点整行）；expandRowKeys 默认展开的行主键数组（依赖 row-id）；accordion 同级是否只能展开一行；activeMethod({row}) 返回 false 则不渲染该行展开区；showIcon 是否显示展开图标"},{"property":"sortable","description":"是否允许列数据排序。默认为 true 可排序"},{"property":"auto-resize","description":"表格属性设置 autoResize 属性开启响应式表格宽高的同时，将高度height设置为auto就可以自动跟随父容器高度。"},{"property":"border","description":"是否带有纵向边框"},{"property":"seq-serial","description":"行序号是否连续，开启分页时有效，默认 false"},{"property":"row-class-name","description":"给行附加 className，可为 string 或函数 ({seq, row, rowIndex, $rowIndex, column, columnIndex}) => string"},{"property":"max-height","description":"表格内容区（不含表头/表尾）最大高度，支持整数、px、%"},{"property":"row-span","description":"简易行合并：传入要合并的字段列表，如 [{ field: \"area\" }, { field: \"province\" }]，相邻且值相同的单元格会自动合并。仅普通表格可用，不可与 tree-config 同用；更复杂合并请用 span-method"}],"events":[{"event":"onFilterChange","functionInfo":{"params":[{"name":"args","type":"Object","description":{"zh_CN":"{$table(表格实例), filters(过滤条件)}"}}],"returns":{}},"description":"当筛选条件发生变化时触发。开启 remote-filter 时会走服务端过滤并调用 fetch-data"},{"event":"onSortChange","functionInfo":{"params":[{"name":"args","type":"Object","description":{"zh_CN":"{$table(表格实例), field(排序字段), order(排序方向)}，order 为 asc|desc"}}],"returns":{}},"description":"点击列头执行数据排序前触发。开启 remote-sort 时会走服务端排序并调用 fetch-data"},{"event":"onSelectAll","functionInfo":{"params":[{"name":"args","type":"Object","description":{"zh_CN":"{$table(表格实例), checked(是否选中), selection(选中数据), row(选中行数据)}"}},{"name":"event","type":"Event","description":{"zh_CN":"原生 Event"}}],"returns":{}},"description":"只对 type=selection 有效，当手动勾选全选时触发的事件"},{"event":"onSelectChange","functionInfo":{"params":[{"name":"args","type":"Object","description":{"zh_CN":"表格选中相关信息对象, { $table(表格实例), selection(选中数据), row(选中行数据), checked(是否选中), rowIndex(选中行索引) }"}},{"name":"event","type":"Event","description":{"zh_CN":"原生 Event"}}],"returns":{}},"description":"只对 type=selection 有效，当手动勾选并且值发生改变时触发的事件"},{"event":"onToggleExpandChange","functionInfo":{"params":[{"name":"args","type":"Object","description":{"zh_CN":"{$table(表格实例), row(行数据), rowIndex(行索引)}"}},{"name":"event","type":"Event","description":{"zh_CN":"原生 Event"}}],"returns":{}},"description":"当行展开或收起时触发"}],"slots":{}}},{"name":"卡片组件","component":"TinyCard","description":"强大卡片组件，用于包裹展示内容。","schema":{"properties":[{"property":"auto-width","description":"卡片的宽度是否自动撑开，设置后将不再给卡片设置固定宽度"},{"property":"type","description":"设置卡片类型,可选值为\"text\",  \"image\",  \"video\",  \"logo\", 默认是\"text\""},{"property":"src","description":"图片或者视频的地址"},{"property":"title","description":"卡片的标题,字号比正文略大，比h3小"}],"events":{},"slots":{}}},{"name":"日期选择","component":"TinyDatePicker","description":"用于输入或选择日期","schema":{"properties":[{"property":"modelValue","description":"双向绑定值","defaultValue":""},{"property":"type","description":"设置日期框的type属性"},{"property":"placeholder","description":"输入框占位文本"},{"property":"clearable","description":"是否显示清除按钮"},{"property":"disabled","description":"是否禁用"},{"property":"readonly","description":"是否只读"},{"property":"size","description":"日期框尺寸。该属性的可选值为： medium 、 small 、 mini"},{"property":"maxlength","description":"设置 input 框的maxLength"},{"property":"autofocus","description":"自动获取焦点"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框改变后的值"}}],"returns":{}},"description":"在 Input 值改变时触发"},{"event":"onInput","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框输入的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onClear","functionInfo":{"params":[],"returns":{}},"description":"点击清空按钮时触发"}],"slots":{}}},{"name":"数字输入框","component":"TinyNumeric","description":"通过鼠标或键盘输入字符","schema":{"properties":[{"property":"modelValue","description":"双向绑定值"},{"property":"placeholder","description":"输入框占位文本"},{"property":"allow-empty","description":"是否内容可清空"},{"property":"disabled","description":"是否禁用"},{"property":"size","description":"输入框尺寸。该属性的可选值为： medium 、small 、 mini"},{"property":"controls","description":"是否使用加减按钮"},{"property":"controls-position","description":"加减按钮位置"},{"property":"precision","description":"数值精度"},{"property":"step","description":"步长"},{"property":"max","description":"可输入的最大数值"},{"property":"min","description":"可输入的最大数值"}],"events":[{"event":"onChange","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框改变后的值"}}],"returns":{}},"description":"在 Input 值改变时触发"},{"event":"onInput","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"输入框输入的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onUpdate:modelValue","functionInfo":{"params":[{"name":"value","type":"string","description":{"zh_CN":"双向绑定的值"}}],"returns":{}},"description":"在 Input 输入值改变时触发"},{"event":"onBlur","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 失去焦点时触发"},{"event":"onFocus","functionInfo":{"params":[{"name":"event","type":"Object","description":{"zh_CN":"原生 event"}}],"returns":{}},"description":"在 Input 获取焦点时触发"},{"event":"onClear","functionInfo":{"params":[],"returns":{}},"description":"点击清空按钮时触发"}],"slots":{}}},{"name":"Text","component":"Text","schema":{"properties":[{"property":"text","description":"文本内容","type":"string"}],"events":[{"event":"onClick","functionInfo":{"params":[],"returns":{}},"description":"点击时触发的回调函数"}],"slots":{}}},{"name":"TinyIcon","component":"TinyIcon","description":"图标组件。可作独立节点：{\"componentName\":\"TinyIcon\",\"props\":{\"name\":\"IconDel\"}}。作为 TinyButton 的 icon 属性时必须使用 JSSlot：{\"icon\":{\"type\":\"JSSlot\",\"value\":[{\"componentName\":\"TinyIcon\",\"props\":{\"name\":\"IconDel\"}}]}}","schema":{"properties":[{"property":"name","description":"图标名称，仅允许使用：IconSearch（放大镜，搜索）、IconDel（垃圾桶，删除）、IconDelete（叉号 X，删除/清除）、IconEdit（铅笔，编辑）、IconPlus（加号）、IconPlusCircle（圆圈加号，新增）、IconMinusCircle（圆圈减号，减少）、IconClose（关闭 X）、IconSuccess（成功勾选）、IconWarning（警告）、IconError（错误）、IconInfo（信息）、IconCheck（勾选）、IconYes（确认勾）、IconCalendar（日历）、IconUser（用户/人物）、IconSetting（设置/齿轮）、IconDownload（下载）、IconUpload（上传）、IconRefresh（刷新循环箭头）、IconArrowDown（向下箭头）、IconArrowLeft（向左箭头）、IconArrowRight（向右箭头）、IconArrowUp（向上箭头）、IconPopup（横向三点，更多操作）、IconHelpCircle（圆圈问号，帮助）、IconTime（时钟，时间）、IconCopy（重叠两页，复制）、IconSave（磁盘，保存）、IconFilter（漏斗，筛选）、IconClearFilter（清除筛选）、IconEyeopen（睁眼，可见）、IconEyeclose（闭眼，隐藏）、IconLock（锁，锁定）、IconUnlock（开锁，解锁）、IconLink（链条，链接）、IconAttachment（回形针，附件）、IconLoading（加载旋转）、IconStarO（空心星，收藏）、IconMail（信封，邮件）、IconPicture（图片/风景框）、IconFolder（文件夹）、IconExport（导出）、IconImport（导入）、IconSort（上下箭头，排序）、IconExpand（展开）、IconFullscreenLeft（对角外扩箭头，全屏）、IconMinscreenLeft（对角内收箭头，退出全屏）、IconShare（分享）、IconLocation（定位图钉）、IconMessageCircle（圆形消息气泡）、IconDocument（文档）、IconPublicHome（房屋轮廓，首页/主页）、IconText（带折角文档纸，文字内容）、IconTaskCooperation（三圆点三角网络，协作/任务协同）","type":"string"}],"events":[{"event":"onClick","functionInfo":{"params":[],"returns":{}},"description":"点击时触发的回调函数"}],"slots":{}}}]
```


## 卡片的 JSON Schema

```json
{"type":"object","properties":{"id":{"type":"string","description":"根节点可选 id"},"methods":{"type":"object","additionalProperties":{"type":"object","properties":{"type":{"type":"string","const":"JSFunction","description":"固定为 JSFunction"},"value":{"type":"string","description":"函数体字符串（可序列化）"},"params":{"type":"array","items":{"type":"string"},"description":"额外传递给函数的参数列表"}},"required":["type","value"],"additionalProperties":false,"description":"JS 函数包装"},"description":"方法集合"},"state":{"type":"object","additionalProperties":{"anyOf":[{"type":"string"},{"type":"number"},{"type":"boolean"},{"type":"null"},{"type":"object","properties":{"type":{"type":"string","const":"JSExpression"},"value":{"type":"string","description":"表达式字符串内容"},"model":{"type":"boolean","description":"是否为双向绑定模型值"}},"required":["type","value"],"additionalProperties":false,"description":"JS 表达式包装"},{"$ref":"#/properties/methods/additionalProperties"},{"type":"object","properties":{"type":{"type":"string","const":"JSSlot","description":"固定为 JSSlot"},"value":{"anyOf":[{"type":"string"},{"type":"object","additionalProperties":{}}],"description":"插槽内容，可为字符串或对象"}},"required":["type","value"],"additionalProperties":false,"description":"插槽包装"},{"type":"array","items":{"$ref":"#/properties/state/additionalProperties"}},{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"}}],"description":"通用属性值：原始值、JSExpression、JSFunction、JSSlot、数组、对象"},"description":"全局状态，表单双向绑定必须此字段"},"refs":{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"},"description":"组件实例引用集合，用于在 methods 和事件处理中访问组件实例"},"componentName":{"type":"string","description":"根组件名，通常为 Page"},"props":{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"},"description":"根组件属性集合"},"children":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"节点可选 id"},"componentName":{"type":"string","enum":["a","h1","h2","h3","h4","h5","h6","p","ol","ul","li","div","img","input","video","label","Text","TinyIcon","TinyForm","TinyFormItem","TinyButton","TinyInput","TinyRadio","TinyRadioGroup","TinySelect","TinySwitch","TinyNumeric","TinyCheckbox","TinyCheckboxButton","TinyCheckboxGroup","TinyDatePicker","TinyGrid","TinyCard"],"description":"组件名（白名单内）"},"props":{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"},"description":"组件属性集合"},"children":{"anyOf":[{"type":"array","items":{"$ref":"#/properties/children/items"}},{"type":"string"}],"description":"子节点数组或字符串"},"componentType":{"type":"string","enum":["Block","PageStart","PageSection"],"description":"节点类型"},"slot":{"anyOf":[{"type":"string"},{"$ref":"#/properties/state/additionalProperties/anyOf/6"},{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"}}],"description":"插槽内容"},"params":{"type":"array","items":{"type":"string"},"description":"参数名列表"},"loop":{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"},"description":"循环渲染配置"},"loopArgs":{"type":"array","items":{"type":"string"},"description":"循环参数名列表"},"condition":{"anyOf":[{"type":"boolean"},{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"}}],"description":"条件渲染配置"}},"required":["componentName"],"additionalProperties":false,"description":"普通节点"},"description":"根子节点数组"},"componentType":{"type":"string","enum":["Block","PageStart","PageSection"],"description":"根节点类型"},"slot":{"anyOf":[{"type":"string"},{"$ref":"#/properties/state/additionalProperties/anyOf/6"},{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"}}],"description":"根插槽内容"},"params":{"type":"array","items":{"type":"string"},"description":"根参数名列表"},"loop":{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"},"description":"根循环渲染配置"},"loopArgs":{"type":"array","items":{"type":"string"},"description":"根循环参数名列表"},"condition":{"anyOf":[{"type":"boolean"},{"type":"object","additionalProperties":{"$ref":"#/properties/state/additionalProperties"}}],"description":"根条件渲染配置"},"css":{"type":"string","description":"全局 CSS 样式字符串"},"fileName":{"type":"string","description":"文件名"},"lifeCycles":{"type":"object","properties":{"onMounted":{"$ref":"#/properties/methods/additionalProperties","description":"页面挂载钩子：schema 渲染完成后执行"},"onUnmounted":{"$ref":"#/properties/methods/additionalProperties","description":"页面卸载钩子：schema 变更或页面销毁前执行"}},"additionalProperties":false,"description":"页面生命周期配置，支持 onMounted、onUnmounted 两种钩子"},"dataSource":{"description":"数据源配置"},"bridge":{"description":"桥接依赖/运行时注入"},"inputs":{"type":"array","description":"输入事件/参数"},"outputs":{"type":"array","description":"输出事件/参数"},"schema":{"description":"内嵌或外部 Schema"}},"required":["componentName"],"additionalProperties":false,"description":"根节点","$schema":"http://json-schema.org/draft-07/schema#"}
```


## 卡片示例

### 双向绑定的表单

```json
{"state":{"formData":{"name":"张三","sex":"男","depart":"HR","protocolStart":"2023-01-01"}},"refs":{"formRef":null},"methods":{"departChange":{"type":"JSFunction","value":"function departChange(value) { console.log(value) }"}},"componentName":"Page","children":[{"componentName":"TinyCard","children":[{"componentName":"h3","children":"更新员工信息"},{"componentName":"TinyForm","props":{"model":{"type":"JSExpression","value":"this.state.formData"},"ref":{"type":"JSExpression","value":"this.refs.formRef"},"labelPosition":"top"},"children":[{"componentName":"TinyFormItem","props":{"label":"姓名","prop":"name","required":true},"children":[{"componentName":"TinyInput","props":{"placeholder":"请输入","modelValue":{"type":"JSExpression","model":true,"value":"this.state.formData.name"}}}]},{"componentName":"TinyFormItem","props":{"label":"性别","prop":"sex"},"children":[{"componentName":"TinyRadioGroup","props":{"options":[{"text":"男","label":"男"},{"text":"女","label":"女"}],"modelValue":{"type":"JSExpression","model":true,"value":"this.state.formData.sex"}}}]},{"componentName":"TinyFormItem","props":{"label":"部门","prop":"depart","required":true},"children":[{"componentName":"TinySelect","props":{"placeholder":"请选择","modelValue":{"type":"JSExpression","model":true,"value":"this.state.formData.depart"},"options":[{"value":"HR","label":"人事部"},{"value":"other","label":"其他部门"}],"onChange":{"type":"JSExpression","value":"this.departChange"}}}]},{"componentName":"TinyFormItem","props":{"label":"入职日期","prop":"protocolStart"},"children":[{"componentName":"TinyDatePicker","props":{"placeholder":"请输入","disabled":true,"modelValue":{"type":"JSExpression","model":true,"value":"this.state.formData.protocolStart"}}}]},{"componentName":"TinyFormItem","props":{"label":""},"children":[{"componentName":"TinyButton","props":{"text":"确认","onClick":{"type":"JSFunction","value":"function() { this.refs.formRef.validate().then(res => { console.log(\"校验通过\", res) }).catch((err) => { console.log(\"校验失败, 失败只做提示，不继续会话\", err) }) }"}}}]}]}]}]}
```

### 表格卡片

```json
{"componentName":"Page","css":".page-base-style {padding: 24px;background: #FFFFFF;}.block-base-style {margin: 16px;}.component-base-style {margin: 8px;}","props":{"className":"page-base-style"},"lifeCycles":{},"children":[{"componentName":"TinyCard","children":[{"componentName":"TinyGrid","props":{"columns":[{"type":"index","width":60},{"field":"name","title":"姓名"},{"field":"id","title":"工号"},{"field":"sex","title":"性别"},{"field":"department","title":"部门"},{"field":"protocolStart","title":"入职日期"},{"field":"email","title":"邮箱"},{"title":"操作","slots":{"default":{"type":"JSSlot","value":[{"componentName":"div","id":"23324161","children":[{"componentName":"TinyButton","props":{"className":"component-base-style","text":{"type":"JSExpression","value":"`编辑${row.name}`"}},"children":[],"id":"24392624"}]}],"params":["row"]}}}],"data":[{"name":"李四","id":"2","sex":"女","department":"技术部","protocolStart":"2019-05-15","email":"lisi@test.com"}],"className":"component-base-style"}}]}],"dataSource":{"list":[]},"id":"body"}
```


## Schema Snippets

以下是一些组件使用的 schema 片段：

```json
[{"componentName":"TinyButton","props":{"text":"按钮文案"}},{"componentName":"TinyForm","props":{"labelWidth":"80px","labelPosition":"top"},"children":[{"componentName":"TinyFormItem","props":{"label":"人员"},"children":[{"componentName":"TinyInput","props":{"placeholder":"请输入","modelValue":""}}]},{"componentName":"TinyFormItem","props":{"label":"密码"},"children":[{"componentName":"TinyInput","props":{"placeholder":"请输入","modelValue":"","type":"password"}}]},{"componentName":"TinyFormItem","props":{"label":""},"children":[{"componentName":"TinyButton","props":{"text":"提交","type":"primary","style":"margin-right: 10px"}},{"componentName":"TinyButton","props":{"text":"重置","type":"primary"}}]}]},{"componentName":"TinySelect","props":{"modelValue":"","placeholder":"请选择","options":[{"value":"1","label":"黄金糕"},{"value":"2","label":"双皮奶"}]}},{"componentName":"TinySwitch","props":{"modelValue":""}},{"componentName":"TinyCheckboxGroup","props":{"modelValue":["name1","name2"],"type":"checkbox","options":[{"text":"复选框1","label":"name1"},{"text":"复选框2","label":"name2"},{"text":"复选框3","label":"name3"}]}},{"componentName":"TinyInput","props":{"placeholder":"请输入","modelValue":""}},{"componentName":"TinyRadio","props":{"label":"1","text":"单选文本"}},{"componentName":"TinyRadioGroup","props":{"modelValue":"1","options":[{"label":"1","text":"选项1"},{"label":"2","text":"选项2"},{"label":"3","text":"选项3"}]}},{"componentName":"TinyRadioGroup","props":{"modelValue":"2","type":"button","options":[{"label":"1","text":"选项1"},{"label":"2","text":"选项2"},{"label":"3","text":"选项3"}]}},{"componentName":"TinyCheckbox","props":{"text":"复选框文案"}},{"componentName":"TinyDatePicker","props":{"placeholder":"请输入","modelValue":""}},{"componentName":"TinyNumeric","props":{"allow-empty":true,"placeholder":"请输入","controls-position":"right","step":1}},{"componentName":"TinyGrid","props":{"editConfig":{"trigger":"click","mode":"cell","showStatus":true},"columns":[{"type":"index","width":60},{"type":"selection","width":60},{"field":"employees","title":"员工数"},{"field":"created_date","title":"创建日期"},{"field":"city","title":"城市"}],"data":[{"id":"1","name":"GFD科技有限公司","city":"福州","employees":800,"created_date":"2014-04-30 00:56:00","boole":false},{"id":"2","name":"WWW科技有限公司","city":"深圳","employees":300,"created_date":"2016-07-08 12:36:22","boole":true}]}},{"componentName":"TinyCard","children":[{"componentName":"h2","children":"员工信息列表"},{"componentName":"TinyGrid","props":{"editConfig":{"trigger":"click","mode":"cell","showStatus":true},"columns":[{"type":"index","width":60},{"type":"selection","width":60},{"field":"employees","title":"员工数"},{"field":"created_date","title":"创建日期"},{"field":"city","title":"城市"}],"data":[{"id":"1","name":"GFD科技有限公司","city":"福州","employees":800,"created_date":"2014-04-30 00:56:00","boole":false},{"id":"2","name":"WWW科技有限公司","city":"深圳","employees":300,"created_date":"2016-07-08 12:36:22","boole":true}]}}]},{"componentName":"TinyCard","props":{"title":"卡片标题","type":"image","src":"https://res.hc-cdn.com/tiny-vue-web-doc/3.26.1/static/images/dsj.png"},"children":[{"componentName":"p","children":"这是一段长文本内容，这是一段长文本内容，这是一段长文本内容，这是一段长文本内容。"}]},{"componentName":"Text","props":{"style":"display: inline-block;","text":"您好！欢迎使用生成式UI。它将重塑大模型交互方式，打造极致顺滑的智能体验。"}},{"componentName":"TinyIcon","props":{"name":"IconDel"}},{"componentName":"Img","props":{"src":"https://tinyengine-assets.obs.cn-north-4.myhuaweicloud.com/files/designer-default-icon.jpg"}}]
```


## this 上下文声明

### this 可访问范围

- `this` 在表达式 `JSExpression` 中可以访问，但不能在表达式内的行内函数中访问
- `this` 也可以在 `JSFunction` 中访问

### this 默认属性

- `this.state`：当前组件所有在 `state` 中声明的变量
- 在 `methods` 里声明的方法可以直接用 `this` 属性访问，例如声明 `hello` 方法，则通过 `this.hello()` 访问

### this 使用方法

让函数访问到当前执行的上下文范围可以有以下几种方式：

**1. JSFunction 模式**

```json
{
    "type": "JSFunction",
    "value": "(event) => this.hello(event, name)"
}
```

**2. JSExpression 扩展参数模式**


如果正在使用`JSExpression`，通过添加`params`参数，可以扩展参数，示例如下：
```json
{
    "type": "JSExpression",
    "value": "this.hello",
    "params": ["name"]
}
```

**启用 params 时需注意：**
- `params` 是额外传递给函数的参数列表，在需要追加时才使用，不要滥用。
- `params` 参数必须是一个字符串数组，每个字符串代表当前上下文 scope 变量名，不要传入 `row.name` 等表达式。
- 添加 `params` 后，函数第一个参数对应原函数的第一个参数，例如原生事件的 `event`，第二个参数开始才是用户指定的 `params` 参数列表，本例中第二个参数才是 `name`。

这两种方式都相当于执行了 `this.hello(event, name)`

**事件绑定更推荐使用 JSFunction 模式**

### this 不存在的属性

- **特别注意：** `this` 上下文并不存在 `this.setState` 方法，任何时候都不要使用，直接给 `this.state` 赋值即可。  
- **再次强调：** 不存在 `this.setState` 方法，不存在 `this.setState` 方法，不存在 `this.setState` 方法。


## Action 定义

以下是一些 Action 的定义：

```json
[
  {
    "name": "submit",
    "description": "参数对象作为提交结果回到对话（进入模型上下文并随会话持久化）；卡片随之转为只读"
  },
  {
    "name": "copy",
    "description": "由宿主写剪贴板"
  },
  {
    "name": "expand",
    "description": "请宿主展开这张卡"
  },
  {
    "name": "openLink",
    "description": "只放行绝对 http/https 链接，由宿主用外部浏览器打开"
  }
]
```

- 如果需要使用 `Action`，直接写 `Action` 的名称即可，不需要具体实现
- `Action` 的参数需要根据 `Action` 的定义来填写
- `Action` 的 `return` 为可选字段，描述返回值结构；省略时表示无返回值；`async` 为可选字段，默认为 `false`，为 `true` 时表示异步 Action，`this.callAction` 会返回 Promise
- 发起 `Action` 调用可以在 `JSFunction` 里通过 `this.callAction(actionName, params)` 来调用

**示例：**

```json
{
  "componentName": "span",
  "props": {
    "onClick": {
      "type": "JSFunction",
      "value": "function() { this.callAction('continueChat', { message: '继续对话' }); }"
    }
  },
  "children": "点击继续对话"
}
```

**异步示例：**

```json
{
  "methods": {
    "handleGetData": {
      "type": "JSFunction",
      "value": "function() { this.callAction('getData').then((res) => { this.state.tableData = res.data; }); }"
    },
    "handleSubmit": {
      "type": "JSFunction",
      "value": "async function() { const valid = await this.callAction('validateCustomForm', { formData: this.state.formData }); if (valid) { this.callAction('continueChat', { message: '继续对话' }); } }"
    }
  }
}
```


## schemaJson 生成规则

- 特别重要：除了上下文数据和工具调用结果以外，禁止使用任何Mock数据
- 表单输入项（input/select/radio 等）必须设置双向绑定，如设置 `modelValue` 的  `type` 为 `JSExpression` 且 `model` 为 `true`，且 `value` 必须具有对应 `state` 状态字段
- 输出的 schemaJson 必须是严格 JSON：属性名带双引号、不使用单引号、最后一个属性后不加逗号、不允许注释
- `children` 不能放进 `props`，它必须是数组或字符串
- 单个组件节点可以用 `condition` 控制显示
- 图片和链接地址不可杜撰，只使用上下文里真实给出的地址
- 组件与属性只能取自下方「可用组件」与「卡片的 JSON Schema」，禁止臆造组件 API
- 禁止设置任何组件的 `background`、`color`、`background-color` 等颜色 CSS 样式；卡片跟随 SpaceCode 明暗主题
- 禁止使用弹窗组件，逻辑里禁止 `alert`、`confirm`、`prompt`
- 注意对话的连续性，不要重复渲染上下文里已经出现过的内容


## 重申

上面是官方物料手册，篇幅长、例子多；真正决定这张卡能不能渲染出来的是这四条：

1. 只输出 ```schemaJson 围栏，围栏之外不写解释性散文。
2. 根 `componentName` 取自白名单（`TinyForm` / `TinyCard` / `div` / `p` …），**不要用 `Page`**。
3. 动作只有 `submit` / `copy` / `expand` / `openLink`；要把结果交回对话就用 `submit`。
4. 沙箱没有网络、没有文件与命令权限：不要写远程资源地址，不要试图改动代码。
