# 项目协同 Supabase V1.0 接入报告

## 结论

现有 migration 已覆盖项目列表和项目详情当前使用的核心字段，不需要新增表或临时字段。本阶段没有新增 migration。成员姓名、头像、部门和岗位不重复写入 `organization_members`，继续通过已存在的 `employee_profiles` 与 `departments` 关联读取。

## 数据库检查

| 模型 | 页面所需能力 | 检查结果 |
| --- | --- | --- |
| `organizations` | 企业归属、名称、Logo、时区 | 已具备 `public_id`、`name`、`logo_url`、`timezone` |
| `organization_members` | 用户与企业成员身份、在职状态 | 已具备 `organization_id`、`user_id`、`status`；展示资料复用 `employee_profiles` |
| `projects` | 名称、描述、负责人、周期、进度、状态、健康度、优先级 | 字段完整，使用 `public_id` 作为页面路由 ID，保留软删除 |
| `project_members` | 项目成员、角色、投入比例、退出状态 | 字段完整，支持负责人/管理者/成员/查看者 |
| `milestones` | 阶段名称、负责人、日期、状态、进度、排序 | 字段完整，并有项目与排序索引 |
| `tasks` | 详情健康统计中的任务完成率与延期数量 | 字段完整，并有项目、负责人、里程碑索引 |
| `project_activities` | 最近项目动态 | 字段完整，按 `project_id, created_at desc` 索引，保持追加式记录 |
| `project_risks` | 活跃风险数量 | 字段完整，具有项目/状态/截止日索引 |
| `files` | 文件元数据、上传人、项目/任务归属 | 字段完整；多实体关联继续复用 `file_relations` |

所有核心表均已配置外键、RLS 和已认证角色权限。当前查询路径使用已有主键、外键或部分索引，没有发现必须新增的页面字段。

## Supabase 配置

项目已包含浏览器客户端和服务端客户端。项目列表与详情使用服务端客户端读取当前请求 Cookie，因此后续登录接入完成后可以直接沿用用户会话和 RLS。

在 `.env.local` 中配置：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

不要在浏览器环境中配置或使用 `service_role` 密钥。仓库已提供同字段的 `.env.example`，当前工作区没有 `.env.local`。

## 数据访问与回退

- `/projects`：服务端批量读取 `projects`，再并行读取 `project_members`、`milestones` 和 `objectives`，统一批量补齐成员档案，避免逐项目 N+1 查询。
- `/projects/[id]`：读取项目后，并行装配目标、成员、里程碑、任务、动态和风险，再补齐真实员工档案。
- 搜索、状态筛选和负责人筛选继续复用现有客户端筛选交互，数据源已替换为服务端返回的真实项目集合。
- 未配置环境变量、连接失败、RLS 拒绝或指定详情不可用时，自动回退到匹配的 Mock 数据；未知项目 ID 不会错误替换成其他项目。
- `/projects` 强制按请求动态渲染，避免构建时把 Mock 结果静态固化。

## 当前验证边界

当前没有 Supabase 项目地址和 publishable key，因此浏览器截图验证的是自动 Mock 回退路径。Supabase 数据装配通过完整的 Supabase 形状测试数据验证；配置真实环境后仍需执行一次已登录会话下的数据库冒烟测试。
