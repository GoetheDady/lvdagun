# 应用与共享协议使用独立 workspace

仓库采用 `apps/backend`、`apps/web` 与 `packages/protocol` 三个 workspace：前两者分别承载本地服务和客户端，后者作为两端共享数据结构与事件格式的唯一来源。独立协议包能让客户端只依赖双方约定，而不在名义上依赖整个本地服务；协议类型不得在任一应用内重复定义。
