# 驴打滚

部署在自己电脑上的个人 AI 管家。本机自托管形态:常驻的本地服务(Agent Hub)+ 浏览器客户端。

## 开发

```bash
bun install          # 安装依赖
bun run dev          # 起本地服务(16345)+ vite 开发服务器(16346),自动打开浏览器
bun run test         # 全部测试(backend + web)
bun run typecheck    # 类型检查
bun run lint         # ESLint
```

## 使用

```bash
bun run serve        # 启动本地服务并打开浏览器(lvdagun serve)
bun run stop         # 停止本地服务(lvdagun stop)
```

- 服务默认监听 `localhost:16345`,可用 `--port` 覆盖
- 所有 API 需携带本机 token(首次启动生成于 `~/.lvdagun/token`)
- 关闭浏览器标签页 ≠ 退出:会话上下文保留在服务进程内存,`stop` 才结束
- 配置与数据存于 `~/.lvdagun/`

## 结构

- `apps/backend/` — 本地服务(Express + Pi Agent SDK):配置存储、模型目录、SSE 对话流、CLI
- `apps/web/` — 浏览器客户端(React + Vite):配置向导、对话页、设置页
- `packages/protocol/` — 客户端与本地服务共享的类型、接口路径和传输配置

领域术语见 `CONTEXT.md`,架构决策见 `docs/adr/`,产品需求见 `docs/product-requirements.md`。
