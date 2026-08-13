# AGENTS.md

驴打滚(lvdagun)— 基于 electron-vite 的 Electron + React + TypeScript 桌面应用。

## 命令

- 使用 **bun** 而非 npm 执行命令
- 提交前必须通过 `bun run lint && bun run typecheck`

## Commit 规范

- 格式 `<type>: <中文描述>`,如 `feat: 新增窗口管理`;描述用中文、简洁说明变更
- type 白名单与校验规则见 commitlint.config.mjs

## 代码规范

- 注释用中文;函数与组件写完整 JSDoc(@param、@returns、@throws 按需)
- 关键逻辑注释写"为什么":这么写的原因、不这么写的后果;简单代码不写注释

## 目录结构

- `resources/` 随应用打包、运行时读取;`build/` 仅打包时使用(安装包图标、签名文件)
- `.agents/skills/` — 项目内 AI 技能(来自 mattpocock/skills)
