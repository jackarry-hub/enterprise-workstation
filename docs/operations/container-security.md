# 容器运行时安全基线

QuantXY 容器以非 root 用户运行。Compose 对工作站和三个恢复 Worker 统一启用只读根文件系统、`cap_drop: ALL`、`no-new-privileges`、PID/CPU/内存上限、`init` 和受限 `/tmp`。工作站仅把 Next.js 运行缓存挂载为独立 tmpfs，不把业务数据写入容器层。

就绪检查固定访问 `/api/health/ready`。该端点只有在认证配置有效、数据库可达且 `202609010001` 迁移标记生效时返回 200；其余情况返回 503，且不输出主机、密钥或数据库错误。容器启动成功但就绪失败时不得进入负载均衡。

上线前必须在服务器执行并保存以下证据：Compose 规范化配置、镜像摘要、非 root 身份、只读写入失败、Capabilities 为空、`NoNewPrivileges=true`、资源限制、就绪探针由 503 转为 200，以及停止/重启后的恢复结果。本机没有 Docker 时这些项目必须保持 `BLOCKED`，不得以静态配置检查替代镜像运行证据。
