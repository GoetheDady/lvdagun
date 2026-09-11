# 页面过渡用 React 19.3 的 ViewTransition,不迁 data router

页面切换动画走 React 19.3 转正的 `<ViewTransition>`(包在 `apps/web/src/app.tsx` 的路由元素上),而不是 react-router 自带的 `viewTransition` 选项。后者在声明式路由下是空操作:`viewTransitionOpts` 只在 data router 的 `RouterProvider` 里被消费,而 `<BrowserRouter>` 的 `navigate` 只是 `navigator.push(path, state, options)`,第三个参数没人读;要用它就得先把路由表迁到 `createBrowserRouter` + `RouterProvider`。`<BrowserRouter>` 默认已经把每次 location 变更包在 `React.startTransition` 里,`<ViewTransition>` 要的前提本来就满足,导航代码一行没改。

**Status**: accepted

## 约束与代价

- **每个路由的过渡边界必须带自己的 `key`。** 同一位置、同一组件类型时 React 只做原地更新,边界没被插入或删除,`enter`/`exit` 静默不触发——不报错、不警告,只能靠实拍发现。
- **`update` 一律关掉**(`default="none"` 只留 `enter`/`exit`)。页面内部的状态变化(流式回复、列表刷新)不该让整页闪一下;嵌套的 `<ViewTransition>` 会自己接管子树里的变更。
- **对话 ↔ 设置只单向动画。** 进对话页要先过 `ConfigGuard` 读配置,那一次提交渲染的是守卫的空白占位,过渡的新快照就是空页;所以由对话进设置是进出都有动画,由设置进对话只有退出动画(旧页面淡出,露出实时渲染的对话页)。要修得让守卫不在每次导航重读配置,那是另一件事。
- **React 不处理 `prefers-reduced-motion`。** 全局那条 `*` 规则压不到 `::view-transition-*` 伪元素,`main.css` 里单独关一次。
- **后退/前进不播动画。** React 明确跳过 popstate 触发的过渡(没有 Navigation API 的路由都这样),要动画得换用 Navigation API 的路由。

## 已否决的方案

- **迁到 data router 用 react-router 的 `viewTransition`。** 顺带能拿到 `<Link viewTransition>`、`useViewTransitionState` 与 loaders,但今天要重写路由表和守卫,收益只有过渡动画本身。
- **手写 `document.startViewTransition` 包住每个导航点。** 十几处导航各包一次、容易漏,而且 React 自己会调 `startViewTransition`,手动再起一个会互相打断——官方明确要求不要这么做。
- **不升 React,用 19.2 的 `unstable_ViewTransition`。** 19.2.8 的 `react-dom` 没有公开导出这个组件(只有 canary 类型里有),而且用实验 API 等于"以后再换"。
