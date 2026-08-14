# AGENTS.md

驴打滚(lvdagun)— 本机自托管的个人 AI 管家:bun workspace 双包(backend 本地服务承载 Agent Hub,web 为浏览器客户端),TypeScript 全栈。

## 命令

- 使用 **bun** 而非 npm 执行命令
- 提交前必须通过 `bun run lint && bun run typecheck`

## Commit 规范

- 格式 `<type>: <中文描述>`,如 `feat: 新增窗口管理`;描述用中文、简洁说明变更
- type 白名单与校验规则见 commitlint.config.mjs

## 代码规范

- 注释用中文;函数与组件写完整 JSDoc(@param、@returns、@throws 按需)
- 关键逻辑注释写"为什么":这么写的原因、不这么写的后果;简单代码不写注释

## 架构原则

1. 无历史包袱:过时代码直接删,不写兼容层、migration、fallback
2. 最简实现:满足当前需求即可,不做预防性抽象、不加多余配置层
3. 分层演进:先跑通最小端到端版本,再逐层加复杂度;不为未完成的复杂度拆掉能跑的东西
4. 模块化:组件保持模块化,关注点分离
5. 用成熟库:优先成熟、有人维护的库,无明确理由不自己重写
6. 先查已有依赖:翻项目里已装的依赖能做什么,再考虑加新包或自写
7. 长期架构:架构决策往长了做,不接受"先这样以后再换"的临时方案
8. 复用成熟模式:先看成熟产品怎么解决同类问题,用已验证的模式,不从零发明

## 目录结构

- `backend/` — 本地服务(Express + Pi SDK);`web/` — 浏览器客户端(Vite + React)
- 测试文件统一放各包的 `tests/` 目录(`backend/tests/`、`web/tests/`)
- `.agents/skills/` — 项目内 AI 技能(来自 mattpocock/skills)

## Agent skills

### Issue tracker

Issues 与 PRD 存于 GitHub Issues,统一用 gh CLI 操作。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个 triage 角色标签(needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix),中文含义见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文:根目录 `CONTEXT.md` + `docs/adr/`(文件不存在时静默跳过,由 /domain-modeling 按需创建)。见 `docs/agents/domain.md`。
