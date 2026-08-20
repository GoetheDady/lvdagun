# 客户端与 Agent Hub 使用 WebSocket JSON-RPC 2.0

客户端与 Agent Hub 的正式协议统一使用标准 JSON-RPC 2.0,由一条应用级 WebSocket 连接承载请求、响应和通知。选择该方案是为了让同一份版本化协议既服务当前 Web 客户端,又不把未来 Electron、小程序、云端部署和双向调用限制在单向 SSE 模型中;所有动态操作统一进入该协议,HTTP 只保留静态资源、WebSocket 握手和必要的健康检查。

**Status**: accepted

**Consequences**:

- 每条连接必须且只能成功执行一次 `initialize`;双方在此协商驴打滚协议版本与当前已实现的能力,没有共同版本时终止连接,且不提前定义尚无需求的设备方法。
- `initialize` 使用整数 `protocolVersion`;只有破坏兼容性的契约变化才增加版本,兼容新增通过可选字段和能力协商表达。客户端提交 `clientInfo` 与 `capabilities`,Agent Hub 返回 `serverInfo` 与 `capabilities`,当前允许客户端能力为空。
- 当前协议不建模用户、设备或浏览器身份;连接只代表一个已初始化的协议端点,会话继续由 Agent Hub 通过不透明 `sessionId` 管理,未来认证和授权另行设计。
- WebSocket 握手使用稳定子协议名 `lvdagun-jsonrpc` 确认承载的应用协议,兼容版本仍通过 `initialize` 协商,不编码进子协议名。
- 当前只接受 UTF-8 文本帧,每帧恰好承载一个 JSON-RPC 对象;不接受二进制帧,不实现自定义分帧或 JSONL,附件能力另行设计。
- 连接存活使用 WebSocket 标准 ping/pong,不增加业务层 `ping` 方法;客户端断线后重连并恢复订阅,健康检查不进入 JSON-RPC 方法集。
- 每条连接使用有界发送队列;高频文本增量可以按顺序合并,但不得越过工具、状态或结束事件,队列溢出时关闭慢连接并让客户端通过权威快照恢复,不无限缓存。
- 服务端对单条消息设置实现层大小上限,超限直接关闭连接;首版根据最大会话快照测试确定上限,若快照超过合理范围则另行设计分页。
- 协议错误、未初始化、版本不兼容、非法帧、消息超限和发送队列溢出使用 WebSocket 连接级关闭语义;能够发送 JSON-RPC error 时先发送错误,领域错误本身不关闭连接,服务重启使用正常服务关闭语义。
- 只保证同一会话订阅内的事件顺序;不同会话的通知可以交错。同一会话严格遵守快照、暂存事件、实时事件和结束事件的顺序。
- 当前不增加事件 ID,不承诺通知 exactly-once;客户端不得依赖通知去重保持一致性,断线后的权威快照才是校准依据,重复通知的处理应保持安全。
- `packages/protocol` 是唯一 wire contract 来源;迁移增加运行时校验以及后端、客户端 WebSocket contract tests,覆盖初始化、并发响应、订阅快照竞态、断线恢复、慢客户端和非法帧,不以 TypeScript 编译替代真实 JSON 验证。
- JSON-RPC 连接 module 允许任一端发起请求,但当前只实现已有产品行为所需的方法和通知。
- 一条连接可以显式订阅多个会话;`session/subscribe` 返回该会话的权威快照,未订阅的会话不向该连接发送运行事件,`session/unsubscribe` 终止订阅。
- 建立订阅时先在 Agent Hub 内部暂存新事件,再读取权威快照;JSON-RPC 响应先返回快照,随后依次发送暂存事件和实时事件,客户端在订阅响应前不会收到该会话通知。
- 会话和会话列表统一使用 `session/*` 方法: `session/list`、`session/subscribe`、`session/unsubscribe` 与 `session/listEvent`;列表订阅原子返回权威列表快照,后续通知列表变化,不再依靠客户端轮询。
- 产品历史事件与驴打滚权威状态事件统一由 `session/event` 通知承载，参数包含 `sessionId` 和产品事件；Pi 原始事件不得跨越 Hub 边界，见 ADR-0014。
- 提示被接受与 Agent 运行结束仍是两个不同事实；完整助手回复由产品 `AgentRun` 表达，结束边界来自 Pi `agent_settled`，客户端不直接消费该事件。
- `session/prompt` 的响应只确认提示已被接受，不等待 Agent 运行完成；后端在 Pi `agent_settled` 时提交最终产品运行状态，客户端通过产品历史事件观察结束。
- 客户端所有会改变状态的命令都必须使用带 `id` 的 request 并取得成功或错误响应;notification 只用于无需确认且可由权威快照校准的服务端事件。
- 同一连接允许多个请求同时在途并按 `id` 匹配响应,不保证响应顺序;同一会话的状态竞争由 Agent Hub 处理,不依赖传输顺序形成业务原子性。
- 当前不支持 JSON-RPC batch 数组,每个 WebSocket 文本帧只承载一个 JSON-RPC 消息;收到 batch 时按 `Invalid Request` 处理。
- JSON-RPC 标准错误使用标准错误码;可预期领域错误统一使用 `-32000`,并在 `error.data` 中携带供客户端判断的稳定领域 `code`、可展示消息和必要详情,客户端不解析中文消息决定行为。
- 同一协议版本对对象中的未知字段采用宽松读取,但缺少必填字段、字段类型错误或未知枚举值属于 `Invalid params`;破坏性变化提升协议主版本。
- Agent 运行使用明确的 `session/abort` request 停止,不复用 RPC 请求取消;当前不实现通用 RPC 取消。
- 客户端请求超时只表示结果未知,不能据此推断命令未执行或自动重试;重新连接和权威快照用于核对可观察状态,当前不承诺命令幂等。
- 断线后不恢复旧连接,也不持久化或补发事件日志;客户端建立新连接,重新初始化并恢复所需订阅,以新的权威快照校准状态,断线期间的瞬时进度允许缺失。
- 客户端与本地服务同步硬切换,迁移完成后删除旧动态 HTTP 与 SSE 接口,不保留兼容层。
- 本 ADR 取代 ADR-0004 的 SSE 承载决定和 ADR-0011 中依赖 SSE 的实现选择,保留两者关于 Pi 事件语义、客户端投影和快照恢复的决定。
- 只提供一个应用级 `/rpc` WebSocket 入口;会话 ID 和能力类型不编码进 URL,由 JSON-RPC method 区分资源和操作。
- WebSocket JSON-RPC Gateway 只负责连接生命周期、消息校验、request/response 匹配、method 分派和通知发送;Agent Hub interface 继续拥有提示准入、会话并发、权威快照、订阅和领域错误。
