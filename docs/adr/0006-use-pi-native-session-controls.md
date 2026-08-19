# 使用 Pi 原生会话控制

Agent Hub 为每个已加载会话创建独立的 Pi `AgentSessionRuntime`,不在现有 Runtime 上调用 `newSession()`。新建会话时先用 Pi `SessionManager.create()` 取得标准 header 和文件路径,立即写入 JSONL 后再通过 `SessionManager.open()` 创建 Runtime;这样空会话无需等待首条助手消息即可进入会话列表,也符合 ADR-0008 中“同一会话共享唯一 Runtime、不同会话隔离 Runtime”的约束。不同会话可同时进行 Agent 运行,同一会话的提示前置校验与运行仍保持串行。

“分叉为新会话”也不在源会话的共享 Runtime 上调用会替换当前 Runtime 的 `fork()`。Agent Hub 另行打开源 JSONL 的 Pi `SessionManager`,通过 `createBranchedSession()` 提取到所选助手回复的路径,再为新文件创建并注册独立 Runtime。这样源会话身份、事件订阅和正在进行的 Agent 运行都不受影响,派生会话则保留 Pi 记录的模型、思考等级和父会话关系。

停止操作先协调驴打滚待处理消息与 Pi steering、follow-up 队列,再调用 Pi `abortCompaction()` 和 `abort()`。思考等级继续复用 Pi `getAvailableThinkingLevels()` 和 `setThinkingLevel()`:选择器只展示当前模型支持的等级,只允许在会话空闲时切换,由 Pi 的 `thinking_level_changed` 事件确认并从下一次 Agent 运行开始生效。
