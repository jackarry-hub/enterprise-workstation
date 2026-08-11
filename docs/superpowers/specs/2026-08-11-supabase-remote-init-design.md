# Supabase 远程数据库初始化设计

## 目标

将量子星河企业工作站连接到已经创建的 Supabase 项目，安全配置本地环境变量，验证 Data API 与 PostgreSQL 连接，按顺序执行仓库已有 migration，并确认企业身份、角色权限与操作日志结构可用。

## 身份结构

不新增重复的 `public.users` 表，沿用 Supabase 与项目现有设计：

- `auth.users` 保存 Supabase 登录账号。
- `public.organization_members` 保存用户在企业组织中的成员身份。
- `public.employee_profiles` 保存员工资料、部门、岗位和 `skills` 能力标签。
- `public.tenants` 保存租户并通过 `tenant_id` 隔离未来多企业数据。
- `public.roles`、`public.permissions`、`public.member_roles` 和 `public.role_permissions` 实现 RBAC。
- `public.audit_logs` 保存只追加、按租户隔离的操作日志。

## 环境变量

密钥只保存到被 Git 忽略的 `.env.local`，不得写入源码、migration、测试数据或提交记录：

```env
NEXT_PUBLIC_SUPABASE_URL=<Supabase Project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase Publishable Key>
SUPABASE_SERVICE_ROLE_KEY=<Supabase Secret Key>
SUPABASE_DB_URL=<Supabase Direct Connection String>
```

其中仅前两项允许发送到浏览器。`SUPABASE_SERVICE_ROLE_KEY` 与 `SUPABASE_DB_URL` 只能供本地服务端脚本和数据库初始化使用。验证与报告只显示“已配置/未配置”和脱敏项目标识，不输出密钥或数据库密码。

## Migration 执行

使用当前仓库 `supabase/migrations` 中按时间排序的全部 migration：

1. 连接远程 PostgreSQL 并读取 migration 历史。
2. 执行 `supabase db push --dry-run`，确认待执行文件和连接有效。
3. 不使用 `--include-seed`，不执行独立业务 seed 文件。
4. 正式执行 `supabase db push`。
5. 再次读取 migration 历史，确认本地与远程版本一致。

已有 migration 会创建项目后续需要的业务表结构，但不会导入项目、任务、客户、考勤、审批或薪资记录。migration 内的量子星河租户、组织、部门、身份 Provider、角色、权限和角色权限关系属于必要系统配置，允许初始化。

## 验证

初始化完成后执行只读检查：

- Project URL 与 publishable key 能访问 Supabase Data API。
- Direct connection 能访问 PostgreSQL。
- 所有本地 migration 均出现在远程 migration 历史中。
- `tenants` 中存在且仅存在预期的量子星河系统租户。
- `roles` 和 `permissions` 已初始化，角色权限关系存在。
- `employee_profiles.skills` 字段存在。
- `audit_logs` 表、索引、只追加约束和 RLS 已启用。
- 业务记录表没有由本次初始化导入实际业务数据。

## 失败处理

- 环境变量缺失或格式错误时，在连接前停止，不尝试 migration。
- dry-run 失败时停止，不执行正式 push。
- 远程 migration 历史与本地冲突时停止，输出冲突版本，不使用强制修复。
- 正式 push 失败时保留 Supabase 返回的 migration 名称和脱敏错误，不重放已成功的 migration，不删除远程数据。

## 输出结果

最终报告包括：

- 环境变量配置状态，不显示值。
- API 与 PostgreSQL 连接状态。
- 已应用 migration 清单。
- 身份、角色、权限、技能字段和审计日志验证结果。
- 系统配置数据初始化数量。
- 业务数据未导入的核验结果。
- 后续接入飞书 OAuth 和员工名单的建议，不在本阶段执行名单导入。
