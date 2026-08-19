# DeepSeek Harness 是否适合替代 Pi Agent SDK

调查日期: 2026-08-18。本文对照 DeepSeek Harness 与驴打滚当前的 Pi 集成。
源码事实固定到官方 `dsh-v0.1.0-rc.7` 标签对应的 commit
[`99f6f02`](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca)，
避免 `master` 后续变化使引用失真。

## 结论

**现阶段不建议把 DeepSeek Harness 当作 Pi Agent SDK 的直接替代品。**

它在能力上已经是一个完整且设计严谨的 Agent runtime：拥有可替换 Agent loop、
模型适配器、工具管线、事件溯源会话、持久化、子代理、MCP、权限、沙箱、Web 与
headless surface。可是它不是一个与 Pi Agent SDK 同形的嵌入式库，而是由 Cordis
插件树组成的完整运行时/产品。官方 TypeScript SDK 的主路径也是启动一个完整
Harness 子进程，再通过 stdio JSON-RPC 驱动它，而不是在宿主进程里创建一个轻量
Agent 实例。[定位来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/README.md#L5-L11)，
[TS SDK 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/client/README.md#L5-L24)

因此，“替换”有三种不同含义：

| 方案 | 判断 | 主要原因 |
| --- | --- | --- |
| 原接口原语义地换包 | 不可行 | Agent、Session、Event、Tool、取消与生命周期契约都不同，没有兼容层 |
| 把 Harness 作为 sidecar runtime，保留自己的产品壳 | 可做 POC，不宜立即迁移 | 官方 TS SDK 支持该形态，但它远窄于 Web API，且仍缺版本协商、单 prompt 取消、session close 和 prompt 级结果 |
| 以 Harness 为新内核重新平台化 | 技术上可行，属于重写级决策 | 能力完整、扩展性强，但要接受 Cordis、插件配置、事件模型、进程边界和会话格式成为新的基础设施 |

推荐结论是：**保持现状，不启动全面替换；仅在确实需要 Harness 的插件化运行时、
Code Mode、组合式沙箱/工具 provider 或其多种 subagent backend 时，做一个固定版本、
可丢弃的 sidecar POC。** 在官方结束 developer preview、协议具备版本协商与细粒度
取消/关闭前，不应把它放到不可逆的核心迁移路径上。

## 对驴打滚当前实现的判断

驴打滚已经通过 `Hub`/`HubSession` 把 HTTP 会话管理与 Pi 运行时创建隔开，这个边界
可以保留；但边界内部并不是一个薄模型 adapter。`createHub()` 同时使用 Pi 的
`ModelRuntime`、凭据、模型目录、`AgentSessionRuntime`、`SessionManager`、
`SettingsManager`、默认工具和内置 Extension，`PiHubSession` 又直接依赖 Pi 的事件、
队列、压缩、消息投影、模型切换和标题生成能力。
[Hub 创建](../../apps/backend/src/hub/create-hub.ts)，
[会话适配](../../apps/backend/src/hub/pi-hub-session.ts)

耦合还跨过了名义上的共享协议边界：`packages/protocol` 直接导出 Pi 的
`AgentMessage`、`ThinkingLevel` 和 `JsonAgentSessionEvent`，Web 客户端 reducer 按 Pi
的 message/tool/retry/compaction/queue 事件词汇维护界面状态。因此替换 Harness 不只
需要新增一个 `HubSession` 实现，还必须重做共享协议、历史投影、流式 reducer、会话
持久化与对应测试。
[共享协议](../../packages/protocol/src/chat.ts)，
[客户端事件投影](../../apps/web/src/hooks/use-chat-session.ts)

当前 V0 对话闭环已经完成，下一项明确需求是会话树、回退、分支切换和派生会话；Pi
原生提供 entry tree 与 `navigateTree()`，而 Harness 官方仍将 Pi-style session tree
列为 deferred，只提供 boundary-based `fork()`。这使立即迁移不仅没有解决当前缺口，
反而会失去下一步已经选定的底层能力。
[当前对接状态](../pi-session-integration-status.md)，
[Pi 会话能力](../pi-sdk.md#session-management)，
[Harness 限制](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/README.md#L139-L143)

## 定位与架构

DeepSeek 官方把它定义为开源的 “agent harness”，不是模型 SDK。其核心框架是
Cordis，模型 adapter、工具 registry、session log、agent loop 都是插件，并通过
配置替换；插件注册是可逆 effect，卸载插件会撤销注册。
[架构来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md#L9-L13)

运行实例是在启动时组合出的有序插件树。Profile 保存 bundle 列表、外部插件和
用户 patch；官方提供 `web` 与 `headless` 模板。`dsh-base` 装入模型、工具、持久化、
沙箱、审批、设置、凭据和 telemetry，另外两个 bundle 分别加浏览器应用或一次性
runner。这意味着 Harness 同时覆盖 runtime、host 和 UI，而不只是 loop。
[Profile/Bundle 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md#L15-L37)

默认 Agent loop 的一轮由一个或多个 step 组成。每个 step 组装 prompt 与 tool
schema，流式请求模型，记录 chunk/message，执行工具管线，再决定是否继续下一
step。持久事件与运行期拦截事件分离，`agent/request`、`llm/stream` 和工具的三个
阶段都是可包裹/短路的 waterfall。
[Turn flow 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md#L63-L90)

这个架构的优点是能力替换面非常完整；代价是采用它等于采用一套微内核、依赖注入、
事件分类和配置组合范式，不能只替换一次 `AgentSession` 构造调用。

## 运行时与模型耦合

### 运行时

源码构建要求 Node `^22.19.0 || >=24.0.0`，仓库使用 pnpm 11 workspace。
[package.json 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/package.json#L1-L18)

官方 TypeScript SDK 是子进程 client：调用者必须显式给出 `command`/`args`，SDK
懒启动并长期持有完整 Harness runtime；runtime 的实际能力由它自己的
`cordis.yml` 决定。TS SDK 当前不负责寻找或分发 runtime executable。
[TS SDK 运行方式](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/client/README.md#L5-L24)，
[已知限制](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/client/README.md#L44-L49)

Python SDK 则绑定相同版本的 runtime wheel，默认启动单文件
`dsh-jsonrpc-agent`，无需目标机安装 Node。官方二进制只覆盖 Linux x64/arm64 和
macOS 14+ arm64，没有 Windows wheel 或 macOS x64 wheel。
[Python SDK 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/python/sdk/README.md#L10-L27)，
[runtime carrier 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/python/sdk-runtime/README.md#L7-L18)

### 模型

Harness core 的 LLM 层是 provider-neutral adapter registry。Agent loop 只依赖统一
的 message、stream chunk 和 `ctx.llm.stream()`；新 provider 通过 `LlmAdapter`
注册，provider/model 路由由 adapter 拥有。
[LLM seam 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/README.md#L5-L27)，
[扩展来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/README.md#L39-L48)

官方提供两个真实 adapter：

- `dsh-llm-deepseek` 直接用 HTTP + SSE 对接 `deepseek-official`。
- `dsh-llm-pi-ai` 通过 `@earendil-works/pi-ai` 解析多 provider/model。

[双 adapter 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm/README.md#L82-L84)，
[`pi-ai` 依赖来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/llm/llm-pi-ai/package.json#L33-L46)

所以 Harness **不是模型层面锁死 DeepSeek**，但发行配置是 DeepSeek-first：SDK
server 可以复用预注册 adapter，找不到 adapter 时只会为 `deepseek-official`
自动挂载直接 adapter；其他 provider 必须在 `cordis.yml` 中显式组合。
[SDK server 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/server/README.md#L7-L13)

如果替换动机是“消除 Pi”，还要区分 Agent runtime 与模型适配层：采用 Harness
确实会替换 Pi 的 Agent loop/session/tool runtime；但若仍需要 Harness 的广泛
provider catalog，官方路径本身仍依赖一个 `pi-ai` 包。只有使用直接 DeepSeek
adapter 或自行开发 adapter 才能完全移除这层依赖。

## 工具能力

工具通过 `ctx.tools` 动态注册，schema 自动进入 prompt assembly。执行经过
`pre-execute -> execute -> post-execute -> result`，可以分别用于权限决策、包装
超时/指标、变换结果和最终审计；Agent scope 还能限制或 shadow 工具。
[工具扩展来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/cookbook/extension-cookbook.md#L7-L33)

官方工具目录覆盖 Bash/PowerShell、持久 terminal、文件读写与搜索、LSP、Web、
计划模式、用户提问、目标、定时任务、Skills、Todo、background jobs、workflow、
多种 subagent 和 `run_code` Code Mode。工具不是全部默认启用；实际暴露面由 profile、
preset 和 patch 决定。
[工具目录来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/tool-catalog.md#L12-L41)

MCP client 支持 stdio 与 Streamable HTTP，启动时发现工具并注册为
`mcp__<server>__<tool>`，能响应工具列表变化、热重载和断线重连。不过目前只桥接
MCP Tools，不桥接 Resources 与 Prompts。
[MCP 能力来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/mcp/mcp-client/README.md#L5-L32)，
[MCP 行为来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/mcp/mcp-client/README.md#L62-L71)，
[MCP 限制来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/mcp/mcp-client/README.md#L111-L117)

## 会话与客户端能力

Harness 内部会话是 append-only、event-sourced 的 source of truth，模型消息历史从
日志投影得到。核心支持创建、列举与从安全边界 fork live session；持久化是独立
seam，官方 JSONL 和 SQLite backend 共享写入协调、durability checkpoint 与 crash
repair 语义。
[Session 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/README.md#L5-L19)，
[持久化来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-persistence/README.md#L5-L34)

会话日志还保存原始 `assistant/chunk`，fork、resume、transcript、telemetry 和
persistence 都从同一条事件流派生；任何进入模型请求的内容必须能从日志重建。
[日志原则来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md#L92-L96)

但内部能力不等于外部 SDK 能力。当前 TS/Python JSON-RPC wire 只有
`initialize`、`session/prompt`、`shutdown`，以及 session event/status 与 subagent
通知。`session/prompt` 返回的 `messageId` 只代表入队，不对应某个 assistant
message 或 turn result；高层 `run()` 只能从该 receipt 收集到 Agent 下一次 idle，
所以并发 steering/注入的工作也可能进入这段结果。
[Wire 方法来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/protocol/README.md#L11-L25)，
[`run()` 语义来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/client/README.md#L24-L30)

这个 wire 目前明确缺少协议版本协商、prompt cancel 和 session close；放弃一次
运行需要关闭整个 runtime。它也没有 prompt 级 result。
[协议限制来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/protocol/README.md#L35-L39)，
[server 限制来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/server/README.md#L43-L48)

尤其不能用自带 Web UI 的能力反推 SDK 能力。Web profile 使用另一套 Host API，
其中已经有 session list/search/create/history/models/selectModel/rename/fork/prompt、
attachment、queue update、cancel，以及 subagent list/history/prompt/interrupt。SDK wire
没有暴露这套完整 API；要保留自己的产品壳，必须自行补 protocol driver，或者等待
官方 SDK 扩展，而不能直接复用 Web 能力。
[Web Host API 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/host/apiproxy/src/api/rpc-map.ts#L24-L40)，
[SDK wire 对照](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/protocol/README.md#L13-L25)

会话树也不能视为已经对齐 Pi。核心会话文档明确将 “Session branching/tree
(pi-style entry tree)” 标为 deferred，当前只提供基于稳定边界的 `fork()`；而且
`fork()` 只切 live session，persisted-but-unloaded session 不在该 API 范围内。
同一处还说明 session format 仍固定为 `0`，pre-release 阶段不暗示广泛兼容性。
[Session tree/format 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/README.md#L139-L143)

另一个官方入口 ACP 支持 prompt cancel 和权限应答，但它只创建新会话，不支持
load/list/resume/delete/fork；只输出已提交 answer，不输出实时 token、reasoning、
tool activity、plan、title 或 usage，也没有逐 session close。因此它同样不是完整
交互式客户端协议。
[ACP 能力来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/acp/acp/README.md#L20-L34)，
[ACP 限制来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/acp/acp/README.md#L76-L81)

## 扩展性

扩展性是 Harness 最强的部分。Cordis Context 作为 service repository，插件声明
依赖、监听 typed event，并用 reversible effect 注册 prompt section、tool、adapter
或 provider；这使热重载与按 Agent scope 替换能力成为架构原语。
[Cordis 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/cordis-primer.md#L7-L13)

官方 extension map 已给出模型 provider、工具、shell/terminal、后台任务、文件系统、
沙箱、request/tool/turn interception、UI、持久 session state、目标与 fork 的挂载点。
[扩展点来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/architecture.md#L104-L129)

外部 UI 或 protocol driver 可以监听 `session/event` 并调用 `followup()`/`steer()`；
官方也把 stdio driver 的 enqueue receipt、Agent status 与 teardown 契约写成 cookbook。
这说明自定义产品壳在架构上受支持，但要实现自己的 driver，而不是获得一个现成、
稳定、与既有 SDK 同形的 API。
[UI/protocol driver 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/cookbook/extension-cookbook.md#L35-L93)

扩展性的代价是配置与运行拓扑本身成为产品正确性的一部分。例如 profile patch
替换整行 config 而不是深合并；工具、sandbox、approval、persistence 和 adapter
是否存在都由组合决定。
[Bundle 限制来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/bundle/base/README.md#L19-L22)

## 成熟度与许可

成熟度信号是矛盾的：

- 正面：源码包含 unit、E2E、snapshot、Web、性能、压力、平台兼容和多种静态验证
  gate，文档还生成并校验工具、配置、事件与持久化目录。
  [测试/门禁来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/package.json#L19-L62)
- 风险：官方明确标注 developer preview，并承诺会有 breaking changes。
  [来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/README.md#L9-L11)
- 风险：截至调查日唯一 GitHub release 是 prerelease `v0.1.0-rc.7`。
  [Release 来源](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.7)
- 风险：官方暂不接受外部 PR，问题反馈走 Discussions，且维护方自称团队很小。
  [贡献政策来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/CONTRIBUTING.md#L9-L19)
- 风险：JSON-RPC handshake 的 `serverInfo.version` 是未校验的 `0.0.1`，官方明确写明
  没有 compatibility promise。
  [协议来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/sdk/protocol/README.md#L35-L39)

这不是一个功能贫乏的实验品，但也是一个尚未稳定的平台。工程完整度不能抵消公开
兼容性承诺缺失；对新 POC 足够，对承载长期会话数据和稳定宿主协议仍然风险偏高。

仓库与官方 package 均使用 MIT License，可使用、修改、分发和再许可，但分发的
软件副本或重要部分必须保留 copyright 与许可声明；第三方依赖另列 notices。
[MIT 来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/LICENSE#L1-L20)，
[第三方声明来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/README.md#L53-L57)

## 替代可行性与主要风险

| 维度 | Harness 本体 | 作为 Pi Agent SDK 替代时的判断 |
| --- | --- | --- |
| Agent loop 与多步工具调用 | 完整，且 loop 可替换 | 能力满足，但事件与生命周期需重接 |
| 模型 provider | Core 解耦；直接 DeepSeek + `pi-ai` 多 provider adapter | DeepSeek-only 合适；多 provider 时并未完全摆脱 Pi 模型层 |
| 工具、MCP、权限、沙箱 | 能力丰富且可组合 | 可能优于轻量 SDK，但组合错误会改变安全边界 |
| 会话、fork、resume、crash repair | Runtime 内部很强；Pi-style entry tree 仍 deferred | Web Host API 较完整，但 SDK 未暴露；既有会话格式不能直接沿用 |
| 实时事件 | 内部有完整 durable event stream | Wire 暴露 Harness 专有事件，客户端 protocol 与投影需重写 |
| 取消与 prompt 关联 | Agent 内部有取消；ACP 有有限取消 | TS SDK 没有 prompt cancel/close/result，是当前硬缺口 |
| 嵌入方式 | Cordis 插件树可在进程内组合 | 官方消费主路径是 sidecar；直接嵌入会耦合大量 pre-release package API |
| UI | 自带完整 Web 产品，也支持自定义 UI driver | 采用自带 UI 是产品迁移；保留既有 UI 则要重写 driver/projection |
| 稳定性 | `0.1.0-rc.7` developer preview | 不适合要求长期兼容的立即替换 |

主要风险按优先级排序：

1. **兼容性风险**：官方明确会 breaking change，wire 又没有版本协商。
2. **架构迁移风险**：这不是 adapter swap，而是 Agent、Session、Tool、Event 与
   lifecycle 的整体替换。
3. **进程与部署风险**：TS 侧需自行分发和管理 runtime 子进程、stdio 纯净性、退出、
   crash 与版本锁定；Python 的 bundled runtime 不能直接解决 TS 宿主问题。
4. **交互语义风险**：SDK 的 receipt-to-idle 不是 prompt-to-response，且缺少细粒度
   cancel/session close；Web Host 虽有更完整 API，却不是 SDK 的公开能力，容易与
   交互式产品预期冲突。
5. **数据迁移风险**：Harness 持久化的是自己的 `SessionEvent` vocabulary。其文档只
   承诺少量旧记录导入例外，并明确不是通用 v0 migration promise。
   [来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-persistence/README.md#L38-L40)
6. **生态与治理风险**：仅 prerelease、外部 PR 暂停、支持主要靠 Discussions。
7. **安全配置风险**：能力由 composition 决定。官方 minimal SDK 示例就是
   `danger-full-access`，并提醒只能在 disposable checkout/container 中运行；采用方
   必须自行验证实际 profile 的 sandbox/approval/tool 暴露面。
   [来源](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/docs/user/guide/python-sdk.md#L83-L102)

## 建议的验证门槛

若要继续评估，先做隔离 POC，而不是迁移生产代码：

1. 固定 `0.1.0-rc.7`，使用自定义最小 `cordis.yml`，只启用所需 adapter、工具、
   sandbox、approval 与 persistence。
2. 以 sidecar 方式验证启动、崩溃、重连、优雅退出、stderr/stdout 隔离和版本锁定。
3. 用契约测试覆盖 token stream、tool event、steer/followup、取消、并发消息、
   subagent、MCP、session resume/fork 与 crash repair。
4. 证明能稳定映射现有产品所需的客户端事件和会话状态；不能用“最后一个
   assistant message 到 idle”替代严格的 prompt 关联语义。
5. 至少等到官方 wire 有协议版本协商、prompt cancel、session close，并给出兼容性
   政策后，再重新评估全面替换。

POC 的决策问题应是“Harness 的独特能力是否足以抵消一次 runtime 重构”，而不是
“DeepSeek 官方出了 Agent 项目，所以是否应该换”。当前一手证据给出的答案是：
**有研究和试验价值，但没有立即替换依据。**
