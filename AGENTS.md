# AGENTS.md

驴打滚(lvdagun)— 本机自托管的个人 AI 管家:Bun workspace 多包项目,包含本地服务、浏览器客户端和共享通信协议,TypeScript 全栈。

## 命令

- 使用 **bun** 而非 npm 执行命令
- 提交前必须通过 `bun run lint && bun run typecheck`

## 完成门禁

- 每次开发完成并通过测试后,使用 `/ponytail-review` 审查本次 diff
- 修复当前需求范围内可执行的全部发现,然后重新审查并运行受影响检查;直到没有可执行发现才提交,保留项在最终答复中说明理由

## 变更与审计边界

- 先核对 PRD、`CONTEXT.md`、ADR、测试和实际调用方,再判断代码是否可删;已有产品需求、文档说明、测试覆盖或用户可见行为的实现按既有功能保留,不能仅因额外代码量、模型调用或当前只有一个调用方就归为 `delete`/`yagni`
- 明确区分“删除功能”和“简化功能内部实现”;任何会改变用户可见行为、持久化数据或协议语义的建议,先说明影响并等待用户明确授权
- `ponytail-audit` 只生成只读审计报告,不执行删除、重构或依赖移除;报告中的候选项不是变更授权

## Commit 规范

- 格式 `<type>: <中文描述>`,如 `feat: 新增窗口管理`;描述用中文、简洁说明变更
- type 白名单与校验规则见 commitlint.config.mjs

## 代码规范

- 注释用中文;函数与组件写完整 JSDoc(@param、@returns、@throws 按需)
- 关键逻辑注释写"为什么":这么写的原因、不这么写的后果;简单代码不写注释
- 自有源码、测试与普通文档的文件名及目录名使用英文小写 kebab-case;生态约定名称(如 `README.md`、`AGENTS.md`、`vite.config.ts`)保持原样
- TypeScript/JavaScript 标识符遵循语言惯例:组件和类型使用 PascalCase,函数、Hook 与变量使用 camelCase
- 测试统一放在各包的 `tests/` 目录,子目录与文件 basename 镜像被测源码
- 前端源码按技术类型归档;避免使用职责不明确的 `lib` 目录

## 架构原则

1. 无历史包袱:过时代码直接删,不写兼容层、migration、fallback
2. 最简实现:满足当前需求即可,不做预防性抽象、不加多余配置层
3. 分层演进:先跑通最小端到端版本,再逐层加复杂度;不为未完成的复杂度拆掉能跑的东西
4. 模块化:组件保持模块化,关注点分离
5. 用成熟库:优先成熟、有人维护的库,无明确理由不自己重写
6. 先查已有依赖:翻项目里已装的依赖能做什么,再考虑加新包或自写
7. 长期架构:架构决策往长了做,不接受"先这样以后再换"的临时方案
8. 复用成熟模式:先看成熟产品怎么解决同类问题,用已验证的模式,不从零发明
9. Pi-first:设计 Agent 功能时先归入 Pi 原生能力、Extension、Skill 或 Prompt Template;会话、模型、事件与工具语义复用 Pi,确定性能力和生命周期干预使用 Extension,驴打滚核心只承载产品外壳与 Web 投影;涉及 Pi 设计或实现时先读 `docs/pi-sdk.md`
10. 按需扩展:已确认的具体功能需求才触发 Extension 开发;当前阶段保持 Extension 关闭,不预先搭建扩展基础设施

## 目录结构

- `apps/backend/` — 本地服务(Express + Pi SDK);`apps/web/` — 浏览器客户端(Vite + React)
- `packages/protocol/` — 客户端与本地服务共享的数据结构、事件格式与传输约定
- 测试文件统一放各应用的 `tests/` 目录(`apps/backend/tests/`、`apps/web/tests/`)
- `.agents/skills/` — 项目内 AI 技能(来自 mattpocock/skills)

## Agent skills

### Issue tracker

Issues 与 PRD 存于 GitHub Issues,统一用 gh CLI 操作。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色标签(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix),中文含义见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文:根目录 `CONTEXT.md` + `docs/adr/`(文件不存在时静默跳过,由 /domain-modeling 按需创建)。见 `docs/agents/domain.md`。
