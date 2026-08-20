# 由驴打滚持有产品会话历史

驴打滚使用独立的产品会话历史作为客户端展示、断线恢复和多客户端同步的唯一权威，Pi JSONL 继续只作为模型上下文、工具结果和原生分支操作所需的执行历史。产品历史以 `AgentRun` 聚合一次从 `agent_start` 到 `agent_settled` 的完整助手回复，通过稳定关系表和版本化 JSON payload 持久化到 SQLite；只有 Pi 事件映射器理解 Pi 事件，客户端协议不再暴露或解释 Pi 消息。

**Status**: accepted

**Consequences**:

- 一条助手回复可以包含多次模型调用、工具运行、重试和运行期间追加的用户消息，但只显示一组复制、分叉和发送时间操作。
- 自动重试只取代最近一次失败模型调用的助手片段；被取代片段作为内部事实保留但不展示，重试卡固定在失败发生的位置并原地更新。最终失败时保留最后一次尝试已经生成的部分内容。
- SQLite 保存 `sessions`、`branches`、`agent_runs`、`timeline_items`、`source_references` 和 `blobs`；产品标识对客户端稳定，Pi `entryId` 与 `toolCallId` 只作为内部来源引用。
- 产品历史变更先提交再广播。快照包含已提交历史、revision 和活动内存草稿；文本增量不逐 token 落盘，revision 不连续时客户端重新取得产品快照。
- 图片和较大二进制数据写入 BLOB，timeline JSON 只保存引用。首版使用 Bun SQLite；未来多实例云部署改用 PostgreSQL 仓储实现，不共享 SQLite 文件。
- 产品历史模块独立于 `PiAgentSessionAdapter`，不使用 Pi Extension；只有 `pi-history-event-mapper.ts` 负责把 Pi 生命周期映射为产品事实。
- 产品数据库是会话列表、标题、归档状态、排序和当前分支的权威。跨产品库与 Pi 文件系统的生命周期操作使用可恢复意图状态。
- 本次切换不迁移旧会话；V1 产品历史在 SQLite 中持久记录一次性清理是否完成，只有清空既有活动和归档 Pi 会话成功后才写完成标记，失败则在下次启动继续清理。未知的未来 schema version 必须拒绝启动，不能静默降级或删除历史。
