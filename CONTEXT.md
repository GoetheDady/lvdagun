# 驴打滚

个人 AI 管家应用,本机自托管形态:常驻本机的 Agent Hub + 浏览器客户端。本上下文覆盖产品领域概念:架构角色、模型配置与首次配置向导。

## Language

**Agent Hub**:
常驻本机的 Agent 内核,负责模型对话、工具执行与上下文管理。V0 承载于本机 Web 服务进程。
_Avoid_: 内核、服务端、后台

**本地服务**:
常驻本机的 Web 服务进程,承载 Agent Hub 与模型会话,提供本地 HTTP 接口,由 CLI 启动/停止。
_Avoid_: server、后台进程

**客户端**:
连接 Hub 的接入端,无状态,只负责交互与展示。V0 为浏览器页面;Electron 壳后置,仅作窗口与托盘。
_Avoid_: 前端、界面

**Agent 运行**:
Agent Hub 接受一条用户提示后,完成全部模型调用、工具执行、自动重试及收尾的一次处理过程。同一会话同一时间只允许一次 Agent 运行。
_Avoid_: 请求、回复生成

**工具运行**:
Agent 为完成任务而调用一个工具并取得结果的过程。一次 Agent 运行可以包含一个或多个串行或并行的工具运行。
_Avoid_: 工具消息、工具事件

**上下文压缩**:
Agent Hub 将较早的对话归纳为摘要,以控制后续模型调用所需上下文长度的过程。上下文压缩不会清空用户看到的历史。
_Avoid_: 清空历史、删除消息

**新会话**:
不携带当前对话历史的独立 Agent 会话。创建新会话是切换对话,不表示删除旧会话。
_Avoid_: 清空会话、重置聊天

**思考等级**:
控制模型在后续调用中投入多少推理能力的等级。可选等级由当前模型决定,不支持思考的模型只有关闭等级。
_Avoid_: 推理开关、思考模式

**Provider**:
提供大模型 API 的服务商,以 SDK 内置 id 标识(如 anthropic、openai、deepseek)。
_Avoid_: 平台、渠道、厂商

**模型配置(ModelConfig)**:
Provider、modelId、apiKey 三字段的组合,存于 `~/.lvdagun/config.json`,决定 Hub 使用哪个模型对话。
_Avoid_: 设置项、config

**配置向导**:
首次访问的三步引导:选 Provider → 填 API Key 并测试连接 → 选 Model。完成后写入模型配置。
_Avoid_: 初始化流程、onboarding

**测试连接**:
用所选 Provider + API Key 发起最小模型请求(1 token,10 秒超时),验证凭证与网络链路可用。
_Avoid_: 连通性检查、ping

**已配置 / 未配置**:
模型配置中 provider 与 modelId 均有效即为已配置(apiKey 允许为空);未配置时访问进入配置向导。
