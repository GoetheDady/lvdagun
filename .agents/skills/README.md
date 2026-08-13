# .agents/skills 技能清单

来自 [mattpocock/skills](https://github.com/mattpocock/skills) 的项目内 AI 技能。每个技能目录内含 `SKILL.md`,AI 助手在匹配场景时自动调用。

## engineering(工程流程)

| 技能 | 用途 |
| --- | --- |
| ask-matt | 技能路由:不确定该用哪个技能/流程时,先问它 |
| code-review | 从固定节点(commit/分支/PR)审查改动,从"规范"和"需求符合度"两个维度并行评审 |
| codebase-design | 深模块设计的共享词汇表:设计模块接口、找深化机会、定边界 |
| diagnosing-bugs | 疑难 bug 和性能回归的诊断循环(用户说 diagnose/debug 时用) |
| domain-modeling | 建立和打磨领域模型:统一术语、记录架构决策(ADR)、维护术语表 |
| grill-with-docs | 拷问式打磨方案,过程中同步产出 ADR 和术语表文档 |
| implement | 基于 spec 或 tickets 实现功能 |
| improve-codebase-architecture | 扫描代码库的深化机会,生成可视化 HTML 报告,再逐个拷问 |
| prototype | 造一次性原型验证设计问题(状态模型、UI 手感) |
| research | 针对问题检索高可信来源,结论落成仓库内的 Markdown |
| resolving-merge-conflicts | 解决进行中的 git merge/rebase 冲突 |
| setup-matt-pocock-skills | 首次使用前:配置 issue 跟踪器、triage 标签词汇、领域文档布局 |
| tdd | 测试驱动开发(red-green-refactor),含好测试的标准、mock 与集成测试 |
| to-spec | 把当前对话直接合成 spec 并发布到 issue 跟踪器 |
| to-tickets | 把计划/spec 拆成有依赖边(branching edges)的追踪子弹式 tickets |
| triage | 让 issue 和外部 PR 走过状态机:分类、验证、必要时拷问、写 agent 可读简报 |
| wayfinder | 超大工作量(单个会话装不下)规划:以决策 ticket 为地图,逐个解决 |
| wizard | 生成交互式 bash 向导,带人走只有人类能完成的步骤(配置凭证、CI secret、迁移等) |

## productivity(个人生产力)

| 技能 | 用途 |
| --- | --- |
| grill-me | 拷问式访谈,打磨计划或设计 |
| grilling | 对计划/决策/想法进行高强度拷问(用户说 grill 相关词时用) |
| handoff | 把当前对话压缩成交接文档,交给另一个 agent 接手 |
| teach | 在本工作区内教你一个新技能或概念 |
| to-questionnaire | 把你自己答不了的决策变成问卷,让别人填写 |
| wait-what | 停顿:上一条消息没讲明白,重新表达一次 |
| writing-for-agents | 写给 agent 的文档:创建/修改 skills、AGENTS.md、CLAUDE.md 时用 |

## misc(杂项)

| 技能 | 用途 |
| --- | --- |
| git-guardrails-claude-code | 设置 Claude Code 的 git 钩子,拦截危险命令(push、reset --hard、clean、branch -D 等) |
| migrate-to-shoehorn | 测试文件里 `as` 类型断言迁移到 @total-typescript/shoehorn |
| scaffold-exercises | 生成练习题目录结构(章节、题目、答案、讲解),保证过 lint |
| setup-pre-commit | 配置 Husky pre-commit 钩子(lint-staged + Prettier + 类型检查 + 测试) |

## in-progress(开发中,谨慎使用)

| 技能 | 用途 |
| --- | --- |
| claude-handoff | 把当前对话交接给一个新的后台 agent 立即接手 |
| loop-me | 拷问式梳理你想构建的工作流规范 |
| setup-ts-deep-modules | 接入 dependency-cruiser,让每个包成为深模块(实现藏在子目录,只能从入口文件访问) |
| writing-beats | 写作·成型:把原材料组装成有节奏的旅程 |
| writing-fragments | 写作·探索:挖掘原始片段,尚无结构 |
| writing-shape | 写作·成型:把原材料逐段塑形成文章 |
