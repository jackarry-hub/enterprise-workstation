# QuantXY 权限矩阵

## Roles

验证角色为 owner、admin、supervisor、department_head、employee、hr、finance；另设第二租户身份验证隔离。角色只是权限集合来源，最终仍需成员状态、租户/组织和数据范围共同判定。

## Permission matrix

| 能力 | owner/admin | supervisor/department_head | employee | hr | finance |
| --- | --- | --- | --- | --- | --- |
| 组织与角色配置 | 管理 | 只读所辖 | 本人 | 员工档案管理 | 只读必要字段 |
| 项目/任务 | 全组织管理 | 所辖项目/直属范围 | 参与项目与本人任务 | 只读必要字段 | 项目财务范围 |
| 客户 | 依 `customer.*` | 被分配/管理范围 | 被分配范围 | 无默认权限 | 合同必要字段 |
| 审批/费用 | 管理/审批 | 所辖审批 | 本人提交/查看 | 人事审批范围 | 费用/付款范围 |
| 薪资 | 依 `salary.manage` | 无默认权限 | 仅本人 | 政策/人员必要范围 | 薪资核算范围 |
| 知识/AI/Agent | 依细粒度权限 | 范围内 | 已授权资源 | 无越权 | 无越权 |

## Verification

数据库 pgTAP 必须覆盖每个角色的允许/拒绝、直属关系、离职禁用和第二租户 0 可见。浏览器 E2E 验证页面显隐和服务端拒绝一致；不能用 owner 会话替代 supervisor，也不能把按钮隐藏当作授权证明。

