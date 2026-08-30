# QuantXY 回滚运行手册

## Stop conditions

迁移哈希不一致、跨租户读取、审计可变、数据丢失、5xx/延迟越线、就绪持续 503、外部调用不可恢复或凭据泄露均立即停止流量并冻结写入。

## Application rollback

仅数据库向后兼容且回滚镜像摘要已验证时切回上一版本。先停止扩流、解析镜像标签到摘要、启动、等待就绪，再恢复最小 Canary；禁止复用未知 latest 标签。

## Database recovery

不可逆数据语义变更时禁止只回滚应用。按 `recovery-drill-runbook.md` 从已验证 backup ID 恢复到隔离目标，核对数据库与 Storage 后再决定切换；不关闭 RLS、不伪造迁移记录。

## Verification

回滚后验证配置/迁移就绪、七角色、跨租户 0 可见、核心读写、审计、文件和外部失败路径。记录 RPO/RTO、影响行/对象、执行人、复核者和后续修复候选。

