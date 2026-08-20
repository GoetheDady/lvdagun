# 通过 SSE 镜像 Pi JSON 事件

**Status**: superseded by ADR-0013 and ADR-0014

该 ADR 记录了 V0 曾采用的方案。SSE 承载已由 ADR-0013 的 WebSocket JSON-RPC 2.0 取代，客户端消费 Pi JSON 事件的决定已由 ADR-0014 的产品会话历史取代。

当前 Pi 原始事件不会跨越后端 Hub 边界。后端将其映射为产品 `AgentRun`、timeline 和活动草稿，先持久化可恢复事实，再通过 JSON-RPC 发送产品事件。停止、重试、工具和上下文压缩的展示语义由 ADR-0014 的产品历史模型承载。
