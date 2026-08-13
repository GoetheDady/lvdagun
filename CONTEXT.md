# 驴打滚

个人 AI 管家桌面应用。本上下文覆盖产品领域概念:架构角色、模型配置与首次配置向导。

## Language

**Agent Hub**:
常驻本机的 Agent 内核,负责模型对话、工具执行与上下文管理。V0 承载于 Electron 主进程,V2 起独立为进程/服务。
_Avoid_: 内核、服务端、后台

**客户端**:
连接 Hub 的接入端,无状态,只负责交互与展示。V0 为 Electron 桌面壳(渲染进程)。
_Avoid_: 前端、界面

**Provider**:
提供大模型 API 的服务商,以 SDK 内置 id 标识(如 anthropic、openai、deepseek)。
_Avoid_: 平台、渠道、厂商

**模型配置(ModelConfig)**:
Provider、modelId、apiKey 三字段的组合,存于 `~/.lvdagun/config.json`,决定 Hub 使用哪个模型对话。
_Avoid_: 设置项、config

**配置向导**:
首次启动的三步引导:选 Provider → 填 API Key 并测试连接 → 选 Model。完成后写入模型配置。
_Avoid_: 初始化流程、onboarding

**测试连接**:
用所选 Provider + API Key 发起最小模型请求(1 token,10 秒超时),验证凭证与网络链路可用。
_Avoid_: 连通性检查、ping

**已配置 / 未配置**:
模型配置中 provider 与 modelId 均有效即为已配置(apiKey 允许为空);未配置时启动进入配置向导。
