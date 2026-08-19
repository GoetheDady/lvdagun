# Codex、Claude Code 与 Hermes 的流式传输对比

调查日期: 2026-08-17。本文中的 Hermes 指官方仓库
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent)。

## 结论

不能说 Codex、Claude Code 和 Hermes 都采用驴打滚当前的“每个会话一条长期
SSE `GET`”架构。它们共同采用的是**增量事件流**，但“模型 Provider 到 Agent”
与“Agent 到客户端”是两层不同的传输，不能因为前一层使用 SSE，就推断后一层
也使用 SSE。

| 产品 | 模型 Provider -> Agent | Agent -> 客户端公开接口 | 与驴打滚当前方案相同 |
| --- | --- | --- | --- |
| Codex | Responses API 可用一次请求对应的 HTTP SSE；OpenAI 另有持久 WebSocket 模式。[来源](https://developers.openai.com/api/docs/guides/streaming-responses) | Codex app-server 使用 JSON-RPC；默认 stdio/JSONL，也支持实验性 WebSocket 和 Unix socket。连接初始化一次，随后可启动或恢复多个 thread，并持续接收 turn 通知。[来源](https://learn.chatgpt.com/docs/app-server) | 否 |
| Claude Code | Messages API 的 `stream: true` 使用 SSE 增量返回一次 Message。[来源](https://platform.claude.com/docs/en/build-with-claude/streaming) | 官方 CLI 的 `stream-json` 是逐行 JSON；Agent SDK 向调用方产出 `StreamEvent` 异步序列。[CLI 来源](https://code.claude.com/docs/en/headless#stream-responses)，[SDK 来源](https://code.claude.com/docs/en/agent-sdk/streaming-output) | 否 |
| Hermes Agent | Agent 按 Provider 分别调用 OpenAI-compatible `stream=True`、Anthropic `messages.stream()` 或 Codex Responses 流。[来源](https://github.com/NousResearch/hermes-agent/blob/cf64ca20c5ab99ebf7e8ca272c69edc7ea0636ed/agent/chat_completion_helpers.py#L3271-L3285) | Web/Desktop 客户端使用双向 JSON-RPC WebSocket；`/api/ws` 和名为 `/api/events` 的接口都是 WebSocket，不是 EventSource/SSE。[协议来源](https://github.com/NousResearch/hermes-agent/blob/cf64ca20c5ab99ebf7e8ca272c69edc7ea0636ed/tui_gateway/ws.py#L1-L21)，[路由来源](https://github.com/NousResearch/hermes-agent/blob/cf64ca20c5ab99ebf7e8ca272c69edc7ea0636ed/hermes_cli/web_server.py#L16911-L17010) | 否 |

## 对驴打滚的含义

驴打滚当前用 `EventSource` 连接会话级 `/events`，服务端保持
`text/event-stream` 响应并逐条写入事件；这与现有 ADR 的选择一致
([客户端](../../apps/web/src/services/event-stream.ts)、[服务端](../../apps/backend/src/http/routes/event-routes.ts)、[ADR](../adr/0004-mirror-pi-json-events-over-sse.md))。
这是合理的 V0 设计，但不是上述产品的统一行业模板。

如果以后需要让多个会话在后台同时运行，更接近 Codex app-server 和 Hermes
Desktop 的形态是：用一条应用级长连接承载多个会话的事件，并在事件中携带
`sessionId` / `threadId` 做多路复用。是否因此改用 WebSocket，应由双向控制、
后台并发会话和断线恢复需求决定，而不是由 Network 面板中累计传输字节数决定。

## 公开资料边界

官方公开资料足以确认上述公开 API、CLI、SDK 和开源实现，但没有完整披露 Codex
Desktop、Claude Code 私有客户端或托管网页的全部内部网络链路。因此本文不对这些
未公开链路是否使用 SSE 作推断。
