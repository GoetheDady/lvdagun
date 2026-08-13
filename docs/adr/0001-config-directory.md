# 配置目录使用 ~/.lvdagun 而非 Electron userData

驴打滚的应用数据(配置、未来会话与日志)存放于用户主目录下的 `~/.lvdagun/`,而非 Electron 惯例的 `app.getPath('userData')`。原因:V2 起 Agent Hub 将独立于 Electron 壳成为常驻进程,配置属于内核而非 UI 壳;`~/.lvdagun` 与 UI 框架解耦(对标 Pi 的 `~/.pi/agent`),内核独立时整个目录直接带走。

**Consequences**:

- 路径跨平台需自行拼装(Windows 上为 `C:\Users\<name>\.lvdagun`)
- 目录不会随系统"应用支持目录"的清理与迁移规则走
