# V0 交付形态:web-first,Electron 壳后置

V0 以「本地服务 + 浏览器」交付:Agent Hub 承载于本机 Web 服务进程,客户端为浏览器页面,Electron 壳(窗口 + 托盘 + 加载 localhost)后置到后续里程碑,且 Hub 永久住服务进程、绝不搬回壳主进程。动机:浏览器迭代远快于 Electron(热重载、无打包);架构上一步到位达成原 PRD V2「内核抽成服务」,免去日后从主进程拆出 Hub 的迁移;同时提前支持非桌面设备访问。

**Considered Options**:

- Electron 优先(原 PRD V0):桌面体验完整(托盘常驻、单一安装包),但迭代慢,Hub 与壳耦合,抽离服务时需迁移。
- web-first + 壳后置(选中):Hub 从第一天起就是独立服务;壳成为可选层。

**Consequences**:

- 仓库为 backend(本地服务)/ web(浏览器客户端)双包 workspace,原 Electron 代码删除、V0 从零重写
- PRD V0 改写:「托盘常驻/关窗≠退出」改为「服务常驻/关标签≠服务停止」,启动方式为 CLI + 浏览器
- 服务监听 localhost 引入 CSRF 风险,API 需 token 校验
- V0 的对话会话存服务进程内存,服务停止即丢
