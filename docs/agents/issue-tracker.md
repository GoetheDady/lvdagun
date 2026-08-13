# Issue tracker: GitHub

本仓的 Issues 与 PRD 存于 GitHub Issues,所有操作统一用 `gh` CLI。

## 操作约定

- **创建 issue**:`gh issue create --title "..." --body "..."`;多行 body 用 heredoc
- **读 issue**:`gh issue view <number> --comments`,用 `jq` 过滤评论,同时取 labels
- **列 issue**:`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`,按需加 `--label` / `--state` 过滤
- **评论**:`gh issue comment <number> --body "..."`
- **加/删标签**:`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**:`gh issue close <number> --comment "..."`

仓库从 `git remote -v` 推断,`gh` 在 clone 内运行会自动识别。

## PR 是否作为 triage 入口

**PRs as a request surface: no。** _(若本仓要把外部 PR 当作功能请求处理,改为 `yes`,/triage 会读取此标志。)_

置为 `yes` 时,PR 走与 issue 相同的标签与状态,用 `gh pr` 对应命令:

- **读 PR**:`gh pr view <number> --comments`,diff 用 `gh pr diff <number>`
- **列外部 PR 供 triage**:`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的(丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`)
- **评论/标签/关闭**:`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`

GitHub 的 issue 与 PR 共用一套编号,裸 `#42` 可能是任一者——先用 `gh pr view 42` 解析,失败再回退 `gh issue view 42`。

## 技能说"publish to the issue tracker"时

创建 GitHub issue。

## 技能说"fetch the relevant ticket"时

执行 `gh issue view <number> --comments`。

## Wayfinder 操作

供 `/wayfinder` 使用。**map** 是单个 issue,子 ticket 是其 child issue。

- **Map**:单个 issue,标签 `wayfinder:map`,body 承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`
- **子 ticket**:作为 GitHub sub-issue 链接到 map(`gh api` 走 sub-issues 端点)。sub-issues 不可用时,把子 issue 加入 map body 的 task list,并在子 issue body 顶部写 `Part of #<map>`。标签:`wayfinder:<type>`(`research`/`prototype`/`grilling`/`task`)。认领后 assign 给驱动开发者
- **阻塞关系**:用 GitHub 原生 issue dependencies:`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,其中 `<blocker-db-id>` 是阻塞方的数字 **database id**(`gh api repos/<owner>/<repo>/issues/<n> --jq .id`,不是 `#number` 也不是 `node_id`)。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告(仅开放中的阻塞方——实时闸门)。依赖不可用时,回退到子 issue body 顶部写 `Blocked by: #<n>, #<n>`。所有阻塞方关闭即解除阻塞
- **前沿查询**:列出 map 的开放子 issue(`gh issue list --state open`,限定 map 的 sub-issues / task list),丢弃有开放阻塞方(`issue_dependencies_summary.blocked_by > 0` 或 `Blocked by` 行有开放 issue)或已有 assignee 的;按 map 顺序取第一个
- **认领**:`gh issue edit <n> --add-assignee @me` — 会话中的第一次写操作
- **解决**:`gh issue comment <n> --body "<答案>"` → `gh issue close <n>` → 把上下文指针(gist + 链接)追加到 map 的 Decisions-so-far
