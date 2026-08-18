# 使用 Pi 原生会话控制

Agent Hub 为每个已加载会话创建独立的 Pi `AgentSessionRuntime`,不在现有 Runtime 上调用 `newSession()`。新建会话时先用 Pi `SessionManager.create()` 取得标准 header 和文件路径,立即写入 JSONL 后再通过 `SessionManager.open()` 创建 Runtime;这样空会话无需等待首条助手消息即可进入会话列表,也符合 ADR-0008 中“同一会话共享唯一 Runtime、不同会话隔离 Runtime”的约束。创建空会话不启动 Agent,因此可以在其他会话运行期间执行;全局单 Agent 约束只阻止另一个会话开始新的 Agent 运行。

停止操作先协调驴打滚待处理消息与 Pi steering、follow-up 队列,再调用 Pi `abortCompaction()` 和 `abort()`。思考等级继续复用 Pi `getAvailableThinkingLevels()` 和 `setThinkingLevel()`:选择器只展示当前模型支持的等级,只允许在会话空闲时切换,由 Pi 的 `thinking_level_changed` 事件确认并从下一次 Agent 运行开始生效。
