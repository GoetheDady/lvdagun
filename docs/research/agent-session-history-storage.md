# Hermes、Codex 与 Claude Code 的会话历史存储

调查日期: 2026-08-20。本文只使用官方文档和官方源码。源码引用固定到调查时的
commit；产品文档描述的是调查日可公开确认的行为。

## 结论

三者都不会让客户端直接把一次模型请求的输出当成最终产品历史，但它们采用了不同
层次的设计：

| 产品 | 耐久事实层 | 展示或查询层 | 明确保存的边界 |
| --- | --- | --- | --- |
| Codex | 筛选后的 rollout JSONL，包含消息、推理、工具调用/结果、压缩和 turn 生命周期标记 | SQLite `thread_turns` / `thread_items` 是从 rollout 增量物化的 thread-history 投影 | `TurnStarted`、`TurnComplete`、`TurnAborted` |
| Hermes Agent | SQLite 中的规范化 `sessions` / `messages`；消息同时带模型重放字段和展示字段 | 从同一事实层派生 `model_history` 与 `display_history`，Desktop 再组装 UI parts | 会话生命周期存在；运行时有 `session_id` / `turn_id` / `api_request_id`，但公开 schema 没有单独的 durable turn 表 |
| Claude Code | 每会话一份内部 JSONL transcript，逐行保存 message、tool use 和 metadata | session picker、`getSessionMessages()`、`/export` 等分别提供摘要、可恢复链和人类可读投影 | transcript 保存消息链；公开文档定义 agent loop/turn，但没有公开稳定的 transcript schema 或独立 durable turn 表 |

因此，不能概括为“这些 Agent 都只保存 SDK 历史”或“都另存一套 UI 历史”。更准确
的共同模式是：**保存足以恢复执行的耐久事实，再为产品界面提供稳定投影**。Codex
当前公开源码把这两层区分得最明确；Hermes 把两种语义放在同一数据库；Claude Code
把内部 transcript 作为事实层，并明确警告外部不要依赖其具体格式。

## Codex

### 存储格式与位置

Codex CLI 的本地 rollout 位于
`~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`。[源码](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/rollout/src/list.rs#L424-L427)
官方文档把 `codex resume` 描述为重新打开保存的本地 chat。[OpenAI Docs](https://developers.openai.com/codex/cli/features)

rollout 不是未经筛选的传输抓包。持久化策略保留：

- user/assistant message、reasoning；
- shell/function/custom tool call 及其 output；
- compaction/context compaction；
- `TurnStarted`、`TurnComplete`、`TurnAborted` 等执行标记；
- 会话元数据、turn context、world state 等执行数据。

大量 delta、begin/progress、approval request 和临时错误事件明确不持久化。因此它是
**可重放的语义执行日志**，不是所有实时事件的完整副本。
[持久化策略](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/rollout/src/policy.rs#L8-L20)
[消息与工具项](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/rollout/src/policy.rs#L38-L59)
[生命周期与临时事件](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/rollout/src/policy.rs#L86-L160)

### Turn、工具和产品投影

Codex 另有 `thread_history_1.sqlite`。SQLite schema 将历史物化为：

- `thread_turns`: `thread_id`、`turn_id`、状态、错误、开始/完成时间、首个 user item、
  最终 agent item；
- `thread_items`: item 归属的 `thread_id` / `turn_id`、稳定 item ID、顺序和 JSON；
- `thread_history_projection_state`: 已投影到的 rollout byte offset 和 ordinal。

[数据库文件定义](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/state/src/sqlite.rs#L29-L34)
[thread-history schema](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/state/thread_history_migrations/0001_thread_history.sql#L1-L38)

这构成了公开源码中可确认的独立 read model：rollout 是耐久执行历史，SQLite 是便于
分页和产品读取的 turn/item 投影。它不是第二份互不关联的聊天内容；投影记录 rollout
顺序和 checkpoint，可以从耐久日志增量构造。

### 恢复与分叉

app-server 暴露 `thread/start`、`thread/resume`、`thread/fork`、`thread/read`、
`thread/list` 等 thread 级接口。[官方仓库文档](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/docs/codex_mcp_interface.md#L12-L20)
当前 thread store 的 fork 输入允许选择最新状态、某个 turn 之前或截至某个 turn，说明
turn ID 是恢复与分叉的正式边界，而不是 UI 根据相邻 role 猜出来的。
[fork boundary](https://github.com/openai/codex/blob/3b45c29062ff0e76e71c91b6753290400e7fa8da/codex-rs/thread-store/src/types.rs#L153-L166)

### 公开资料未证明的部分

开源仓库可以证明 CLI/app-server 的本地存储与投影，但不能据此断言 Codex Desktop
或 Codex 云端使用完全相同的物理表和文件布局。它们可以共享协议语义而使用不同的
后端实现。

## Hermes Agent

### 存储格式与位置

Hermes 默认 home 是 `~/.hermes`，可由环境或 profile 改写；权威数据库是
`$HERMES_HOME/state.db`。[home 定义](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_constants.py#L53-L74)
[数据库路径](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_state.py#L349-L396)

网关的 `sessions.json` 只保存 `session_key -> session_id` 路由和活动状态；SQLite
`SessionDB` 才是会话元数据和 transcript 的权威存储。旧的 per-session JSONL 已退出
主路径，SQLite 不可用时的 JSONL 是降级路径。
[官方生命周期文档](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/docs/session-lifecycle.md#L144-L203)

`sessions` 表包含模型、父会话、生命周期、计数、成本、标题、分支和归档状态；
`messages` 表包含：

- role/content/timestamp；
- `tool_call_id`、`tool_calls`、`tool_name`；
- reasoning 及 provider-specific reasoning/message items；
- active/compacted；
- `api_content`；
- `display_kind` / `display_metadata`。

[Hermes schema](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_state_common.py#L259-L344)

### 模型历史与展示历史

Hermes 没有把模型历史和产品历史双写到两个互相竞争的数据库。它在同一消息事实层
中同时保存 provider replay 和 presentation 所需字段：`api_content` 表示实际送给
Provider 的内容，`display_metadata` 只影响展示。
[写入契约](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_state.py#L9267-L9331)

恢复时，一次 lineage 查询派生两个结果：`model_history` 用于修复角色交替并重放给
模型，`display_history` 用于 UI 时间线。Desktop 又把 assistant 的 `tool_calls` 和
独立的 `role=tool` 结果重新组装为 UI parts。
[恢复投影](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_cli/cli_commands_mixin.py#L1085-L1103)
[Desktop hydration](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/apps/desktop/src/lib/chat-messages/hydration.ts#L118-L205)

所以 Hermes 最接近“产品拥有完整历史”：SQLite 本身就是产品可查询的规范化历史，
同时保留足够的模型重放语义，而不是把某个 Provider SDK 文件当最终 UI 模型。

### 边界、恢复与分叉

Hermes 的运行时可区分 `session_id`、`turn_id`、`api_request_id` 和
`tool_call_id`；一次 user turn 内可有多个 Provider API request，工具 hook 也携带
这些关联 ID。[官方 observability 文档](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/docs/observability/README.md#L87-L123)
[工具事件](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/docs/observability/README.md#L125-L188)

但当前公开 `messages` schema 没有 `turn_id`，也没有 Codex 那种独立的 durable turn
表。因此可以确认运行时有明确边界，不能确认每个 turn 边界都作为独立实体写入会话
数据库。

`/branch` 创建新 session ID，记录 `parent_session_id` / `_branched_from`，并复制
截至分叉点的 conversation，包括工具、reasoning 和 API sidecar；原会话保持可访问。
[branch 创建](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_cli/cli_commands_mixin.py#L1302-L1374)
[branch 完成](https://github.com/NousResearch/hermes-agent/blob/6851841112e921537eb7195ef6e8be7d2ca2d2f6/hermes_cli/cli_commands_mixin.py#L1379-L1405)

## Claude Code

### 存储格式与位置

Claude Code CLI 默认把每个会话保存为
`~/.claude/projects/<project>/<session-id>.jsonl`。每行可以是 message、tool use 或
metadata。官方明确说这是 Claude Code 的**内部格式**，版本间会变化，外部程序不应
把它当稳定协议；推荐使用 `/export`、headless JSON、hook 的 `transcript_path` 或
Agent SDK。[官方 sessions 文档](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)

恢复会带回完整 conversation history，包括工具调用与结果，以及部分模型、agent、
permission、goal 和 scheduled-task 状态。
[恢复语义](https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores)

### 执行历史与读投影

Agent SDK 将一次 `query()` 描述为 agent loop；loop 可以经历多个 turn。assistant
message 可以包含 tool use，SDK 执行后以 tool result 继续，直到出现不再调用工具的
最终结果。[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop#turns-and-messages)

同一 transcript 有多种读取方式：

- `/export` 渲染为人类可读文本；
- session picker / `listSessions()` 使用轻量摘要；
- `getSessionMessages()` 返回用于恢复的 user/assistant 消息链并隐藏 transcript
  metadata；
- `store.load()` 才返回完整 raw entries，包含压缩前历史和 metadata。

官方举例：store 可有 503 个 raw entries，而 post-compaction 的
`getSessionMessages()` 只返回 18 条。
[脚本与导出接口](https://code.claude.com/docs/en/sessions#access-conversations-from-scripts)
[post-compaction 投影](https://code.claude.com/docs/en/agent-sdk/session-storage#getsessionmessages-returns-the-post-compaction-chain)

Agent SDK 还允许把不透明、按序的 transcript entries 镜像到 S3、Redis、Postgres
等外部存储。契约要求 `load()` 返回与 `append()` 接收内容深度相等的序列，适配器
不应解释内部 entry；本地 transcript 仍先写，外部 store 是 mirror。
[SessionStore 契约](https://code.claude.com/docs/en/agent-sdk/session-storage#write-your-own-adapter)
[dual-write 行为](https://code.claude.com/docs/en/agent-sdk/session-storage#dual-write-architecture)

这说明 Claude Code 有“事实 transcript + 多种读投影”，但公开资料没有证明 CLI
内部存在一个像 Codex `thread_history_1.sqlite` 那样的独立、稳定产品历史数据库。
另外，官方明确指出 CLI、Desktop、Web 和 VS Code 各自维护自己的 session history，
不能把 CLI 文件布局外推为所有 Claude 产品的统一后端。
[产品边界](https://code.claude.com/docs/en/sessions)

### 分叉

`/branch` 复制截至当前点的 transcript，切换到新的 session ID 继续写，原 transcript
不变；`--fork-session` 提供命令行等价行为。SDK 的 `forkSession` 也不是文件字节复制，
它会重写 session ID 并重新映射 message UUID。
[CLI branch](https://code.claude.com/docs/en/sessions#branch-a-session)
[SDK fork](https://code.claude.com/docs/en/agent-sdk/session-storage#forksession-is-not-a-byte-copy)

## 对驴打滚的启示

已讨论的方向有充分先例，但需要调整一句职责描述：不宜把 Pi 历史仅称为“元数据”。
Pi 历史仍是 Agent 执行、模型上下文和 Pi 原生分支的执行事实；驴打滚历史是产品协议、
展示恢复、多客户端同步和扩展内容的产品事实。

更接近成熟实现的边界是：

1. 驴打滚保存完整、稳定的产品语义记录，并使用自己的 session/reply/block ID；客户端
   只读取这套产品模型。
2. 每个产品记录保留 Pi `entryId`、`toolCallId` 等来源引用，但不把 Pi 的私有文件格式
   当成驴打滚协议。
3. 保存明确的回复/运行边界和顺序，不在刷新后用相邻 role 或时间戳猜测。
4. 区分耐久语义与瞬时传输：文本、工具调用/结果、最终状态和边界应耐久；token delta、
   倒计时和连接进度可以只存在于实时流。
5. 展示记录和模型重放可以共享一份规范化事实层并派生两个 read model，像 Hermes；
   不必从第一天就双写两份完整内容。
6. 如果未来需要高保真审计、跨版本重建投影，再评估 Codex 式“追加日志 + SQLite 投影”；
   当前需求并不自动要求同时维护这两套耐久表示。

因此，当前推荐仍是 SQLite 中的稳定产品语义模型，而不是原样保存所有 Pi 事件；但
schema 应把 run/reply、block、source reference 和状态设为一等概念，避免以后再次从
SDK 消息推断 UI 边界。

