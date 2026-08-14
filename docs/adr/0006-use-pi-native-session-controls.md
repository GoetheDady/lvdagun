# 使用 Pi 原生会话控制

Agent Hub 使用 Pi `AgentSessionRuntime` 管理当前会话,以 `newSession()` 替代项目自定义的清空并重建逻辑,并直接接入 `abort()`、`getAvailableThinkingLevels()` 和 `setThinkingLevel()`。新会话操作在 Agent 运行期间返回 `409`,空闲时才调用 Pi;思考等级通过 Pi 设置持久化,选择器只展示当前模型支持的等级。思考等级允许运行中切换,由 Pi 的 `thinking_level_changed` 事件确认,并从下一次模型调用开始生效。
