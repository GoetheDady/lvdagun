# components/ui 走上游 shadcn radix-vega 方言,不手写简化版

`apps/web/src/components/ui/` 的组件由上游 shadcn registry 生成并统一到 `radix-vega` 方言:`components.json` 声明风格,`main.css` 引入 `shadcn/tailwind.css` 取得 `data-open`/`data-closed` 等把 Radix 的 `data-state` 映射成简写的变体,Radix 基元走统一包 `radix-ui`,`shadcn` 与 `twMerge` 之外不再有自研实现。此前这些文件是手写的简化版(Button 无 `asChild`、Slider 多出私有 `thumbProps`、`marker.tsx` 全自研),与 registry 不同源,导致每次要用新组件都得手抄一遍,上游变动拿不到,基础设施(变体、动画类名)还要自己维护。

**Status**: accepted

## 约束与代价

- **`components/ui/` 是生成物,豁免 AGENTS.md 的 JSDoc 要求。** 该目录由 CLI 生成,补全中文 JSDoc 会因为下次 `shadcn add` 而全部丢失。AGENTS.md 的注释规范只管 `components/chat/`、`components/common/`、`components/wizard/`、`pages/` 这些自写代码。
- **生成物允许局部扩展,但必须在本文记账。** 目前只有一处:`slider.tsx` 的 `thumbProps`。滑块是 Slider 内唯一可聚焦元素,可访问名与值文本只能挂在它上面,而 Radix 不会把 Root 的无障碍属性下发给 Thumb;`chat-page` 的测试按 `role="slider"` + name「思考等级」断言,是该能力的验收依据。重新运行 CLI 覆盖后需要重新补回这一处。
- **`cn` 必须指向项目自己的 `@/utils/class-names`。** shadcn CLI 把 registry 声明的 `cn` 当作 npm 依赖,会装进一个同名的命令行工具(`cn@0.2.6`,带 bin)并把生成代码的 import 指向它;那不是 `clsx + twMerge`,`Tailwind` 冲突类不会合并。每次 `add` 之后都要检查并改回。
- **`shadcn` 是 devDependency。** 存在的唯一理由是被 `main.css` 以 `@import 'shadcn/tailwind.css'` 引用;`@utility` 按需输出,未使用的 scroll-fade/shimmer 不产生任何产物。
- **接受上游的视觉默认值,不做本地覆盖。** 包括按钮按下时下沉 1px、焦点环 `ring-3`,以及 `destructive` 变体的淡红底红字。`session-sidebar` 的删除确认按钮因此不再是实心红——保持与上游一致优先于单点强调。

## 已否决的方案

- **继续手写简化版。** 每次要用新组件都要手抄并裁剪,`data-*` 变体这类基础设施要自己维护,上游修复拿不到。
- **`shadcn add` 后逐个改回旧方言(作用域包 `@radix-ui/react-*` + `data-[state=open]`)。** 每个组件的 import、状态变体、图标引用都要手工重写,而且 CLI 会连带覆盖已被定制的文件;改造成本高于一次性对齐。
