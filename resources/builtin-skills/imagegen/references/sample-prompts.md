# 可复制的提示词样例

每条都是完整可发给 `mcp__spacecode-imagegen__generate_image` 的 `prompt`。
按用户诉求替换尖括号里的内容，删掉不适用的行；不要整段照抄后再加一堆用户没提的要求。

## 封面（竖幅）

```text
Use case: illustration
Asset type: 文章封面
Primary request: 一张关于「深夜写代码」的封面插画
Scene/backdrop: 安静的书房，窗外城市夜景虚化
Subject: 一台亮着屏幕的笔记本电脑，桌上有半杯咖啡
Style/medium: 扁平插画，轻微颗粒质感
Composition/framing: 竖幅，主体在下三分之二，上方留白给标题
Lighting/mood: 屏幕冷光为主光源，安静、专注
Color palette: 深蓝、墨绿、少量暖橙点缀
Text (verbatim): ""
Constraints: 无人物、无水印、不出现任何品牌标识
```

## 产品图（方形）

```text
Use case: product-shot
Asset type: 电商主图
Primary request: <产品名> 的白底主图
Scene/backdrop: 纯白无缝背景
Subject: <产品形态、材质、颜色>
Style/medium: 商业产品摄影
Composition/framing: 方形，正面略偏 15 度，产品占画面 70%
Lighting/mood: 柔光箱三点布光，底部有淡投影
Color palette: 中性白灰，产品本色
Text (verbatim): ""
Constraints: 无手、无道具、无文字、无反光倒影
```

## 界面稿（横幅）

```text
Use case: ui-mockup
Asset type: 落地页首屏设计稿
Primary request: <产品类别> 的官网首屏
Scene/backdrop: 浅色页面，大量留白
Subject: 顶部导航 + 左侧大标题与副标题 + 右侧产品截图占位
Style/medium: 现代简洁网页设计，扁平
Composition/framing: 16:9 横幅，桌面视口
Lighting/mood: 明亮、克制
Color palette: 米白底，深灰字，单一强调色
Text (verbatim): "<主标题原文>"
Constraints: 文字清晰可读，不要出现乱码字形，不要真实品牌 logo
```

## 精灵图（方形，纯色底）

```text
Use case: sprite
Asset type: 2D 游戏道具图标
Primary request: <道具名> 图标
Scene/backdrop: 纯白背景
Subject: 单个 <道具>，居中，完整可见
Style/medium: 卡通描边，厚涂高光
Composition/framing: 方形，正俯视，四周留 10% 边距
Lighting/mood: 均匀顶光，无环境反射
Color palette: 饱和暖色，深色描边
Text (verbatim): ""
Constraints: 只有一个对象、无投影、无背景元素、无文字
```

## 贴图（方形，可平铺）

```text
Use case: texture
Asset type: 材质贴图
Primary request: <材质名> 的无缝平铺贴图
Scene/backdrop: 无场景，纯材质表面
Subject: <纹理特征、颗粒尺度>
Style/medium: 写实材质扫描质感
Composition/framing: 方形，正对表面，四边可无缝拼接
Lighting/mood: 完全均匀，无方向性光照、无高光
Color palette: <主色与变化范围>
Text (verbatim): ""
Constraints: 无阴影、无透视、无边缘暗角、无文字
```

## Banner（宽幅，带文字）

```text
Use case: banner
Asset type: 活动 Banner
Primary request: <活动主题> 的横幅
Scene/backdrop: <背景意象>
Subject: 右侧 <主体元素>，左侧留给文字
Style/medium: 现代插画，几何色块
Composition/framing: 21:9 宽幅，左侧 45% 为文字区
Lighting/mood: 明亮、有活力
Color palette: <两到三个主色>
Text (verbatim): "<标语原文>"
Constraints: 文字为无衬线粗体、水平排列、不被主体遮挡；无水印
```

## 信息图（竖幅）

```text
Use case: infographic
Asset type: 流程信息图
Primary request: 把 <流程名> 画成 <N> 步流程
Scene/backdrop: 浅色底
Subject: 自上而下 <N> 个分区，每区一个图标 + 一行标题
Style/medium: 扁平矢量感插画
Composition/framing: 竖幅，分区等高，箭头连接
Lighting/mood: 中性、清晰
Color palette: 白底 + 单一强调色 + 深灰文字
Text (verbatim): "1. <第一步原文>" / "2. <第二步原文>" / "3. <第三步原文>"
Constraints: 文字严格按给定原文、不要自造词句、图标风格统一
```