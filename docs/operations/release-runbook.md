# QuantXY 发布运行手册

## Candidate freeze

冻结应用 commit/tree、迁移哈希、配置哈希和镜像摘要；工作区必须干净。运行本地总闸门并冻结交付清单。融合资产退役需要绑定 prospective tree 的单独授权，不能先删后补证据。

## Staging

在隔离目标完成只读指纹、备份、dry-run、迁移、容器启动和全验收矩阵。外部证据清单逐文件哈希并由 Staging Owner 使用 Ed25519 签名。任何缺项均为 BLOCKED。

## Canary

仅审批范围内测试成员，观察错误率、非 AI P95、移动交互、数据库连接、队列、外部失败和业务写入。达到停止线立即撤流，禁止边失败边扩容。

## Production authorization

Staging 通过不等于生产授权。新授权必须绑定同一候选和签名证据；生产只执行获批步骤并逐级扩流，发布后观察七天，交接、培训和回滚值班必须已确认。

