# AGENTS.md

驴打滚(lvdagun)— 基于 electron-vite 的 Electron + React + TypeScript 桌面应用。

## 命令

使用 **bun** 而非 npm:

```bash
bun install          # 安装依赖
bun run dev          # 开发模式(HMR)
bun run lint         # ESLint(--cache)
bun run typecheck    # tsc 检查 node + web 两套 tsconfig
bun run format       # Prettier 全量格式化
bun run build        # typecheck + electron-vite build
bun run build:mac    # 打包 mac(另有 build:win / build:linux / build:unpack)
```

提交前必须通过 `bun run lint && bun run typecheck`。

## 代码规范

- Prettier:单引号、**有分号**(semi: true)、printWidth 100、trailingComma es5
- ESLint:typescript-eslint 类型检查规则(recommendedTypeChecked + projectService)、React/Hooks 推荐规则
- 纯类型导入必须用 `import type`(consistent-type-imports)
- 渲染进程(renderer)禁用 console(no-console warn);主进程可用
- 渲染进程 API 通过 preload 的 contextBridge 暴露(`window.electron`)

## 目录结构

- `src/main/` — Electron 主进程(Node 环境)
- `src/preload/` — preload 桥接层(`index.ts` 实现 + `index.d.ts` 全局类型)
- `src/renderer/` — 前端(React,browser 环境;入口 `index.html` + `src/main.tsx`)
- `resources/` — 随应用打包、运行时读取的资源(图标等,主进程用 `?asset` 引入)
- `build/` — 仅打包用素材(安装包图标、mac entitlements),由 electron-builder 使用
- `docs/` — 项目文档(PRD 等)
- `.agents/skills/` — 项目内 AI 技能(来自 mattpocock/skills,含 in-progress 分类)

## 注意

- 构建产物在 `out/`(electron-vite 生成),缓存 `.eslintcache`,均已被 .gitignore
- `.vscode/` 已 gitignore,不推送
- 远端仓库:github.com/GoetheDady/lvdagun(main 分支)
- 国内镜像配置在 `.npmrc`,electron 下载走 npmmirror
