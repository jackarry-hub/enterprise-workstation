# 组织人事员工目录设计说明

## 目标

组织人事 V1 只建立企业员工目录闭环，让企业成员能够查看员工统计、搜索和筛选员工，并进入员工详情查看基础任职信息。

本阶段页面范围：

- `/people`：员工统计、员工列表、搜索筛选。
- `/people/[id]`：员工详情。

本阶段不包含招聘、绩效、工资、复杂权限、部门管理页面和员工档案编辑流程。

## 业务边界

组织人事模型分为三个稳定边界：

1. `organizations` 表示企业租户。
2. `organization_members` 表示系统账号与企业之间的访问关系。
3. `employee_profiles` 表示企业员工档案。

员工档案不能直接合并到 `organization_members`：员工可以在账号开通前录入，也可以在账号停用后继续保留历史档案；外部协作账号也不一定是正式员工。因此 `employee_profiles.organization_member_id` 为可空的一对一关联。

`roles`、`member_roles` 继续负责老板、管理员、部门负责人、普通员工、HR、财务等系统权限；员工岗位由 `employee_profiles.job_title` 表示，不能复用权限角色。

## 用户角色与场景

- 普通员工：查看企业内部员工目录和员工详情。
- 部门负责人：通过部门筛选快速查看本部门成员。
- HR：查看完整员工目录和任职状态；V1 暂不提供编辑入口。
- 老板与管理员：查看企业人员规模和组织分布。

V1 的页面权限统一为企业内有效成员可读；数据写入权限预留给老板、管理员和 HR，但本阶段不开发写入 UI。

## 数据模型

### organizations

现有字段已经满足企业租户边界，本阶段不修改。

### organization_members

现有字段已经满足账号成员关系：

- `organization_id`
- `user_id`
- `status`：`invited`、`active`、`suspended`

该状态只表示系统访问状态，不表示试用、在职、休假或离职。本阶段不向该表加入员工档案字段。

### roles

现有系统角色和角色分配模型满足 V1 权限识别，本阶段不修改。

### departments

新增轻量部门表，用于员工归属、部门筛选和人数统计，不在 V1 开发独立部门管理页面。

字段：

- `id bigint identity primary key`
- `public_id uuid unique`
- `organization_id bigint`
- `parent_department_id bigint null`
- `code text`
- `name text`
- `status text`：`active`、`inactive`
- `sort_order integer`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

约束：

- 同一企业内部门编码唯一。
- 上级部门必须属于同一企业。
- `sort_order >= 0`。

### employee_profiles

新增员工档案表。

字段：

- `id bigint identity primary key`
- `public_id uuid unique`
- `organization_id bigint`
- `organization_member_id bigint null`
- `employee_no text`
- `display_name text`
- `avatar_url text null`
- `work_email text null`
- `phone text null`
- `department_id bigint null`
- `job_title text`
- `manager_employee_id bigint null`
- `employment_type text`：`full_time`、`part_time`、`contractor`、`intern`
- `employment_status text`：`probation`、`active`、`on_leave`、`departed`
- `hire_date date null`
- `departure_date date null`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

约束：

- 同一企业内工号唯一。
- 一个 `organization_member` 最多关联一份员工档案。
- 账号成员、部门、直属负责人和员工档案必须属于同一企业。
- 离职日期不得早于入职日期。
- `/people/[id]` 使用 `public_id`，不暴露内部自增主键。

## 索引与查询

新增以下索引：

- `employee_profiles (organization_id, employment_status)`，仅覆盖未删除记录。
- `employee_profiles (organization_id, department_id)`，仅覆盖未删除记录。
- `employee_profiles (organization_id, display_name)`，仅覆盖未删除记录。
- `employee_profiles (organization_member_id)`，仅覆盖非空关联。
- `employee_profiles (manager_employee_id)`，仅覆盖非空关联。
- `departments (organization_id, status)`，仅覆盖未删除记录。
- `departments (parent_department_id)`，仅覆盖非空关联。

员工列表查询以 `employee_profiles` 为主体，并关联 `departments`、`organization_members`、`member_roles` 和 `roles`。V1 企业规模为 100-500 人，不引入全文搜索或额外搜索服务。

## RLS 与权限

`departments` 和 `employee_profiles` 均启用 RLS。

- `select`：调用 `is_organization_member(organization_id)`，企业内有效成员可读。
- `insert`、`update`：调用 `has_organization_role`，仅允许 `owner`、`admin`、`hr`。
- V1 不开放物理删除；通过 `status` 和 `deleted_at` 保留历史记录。

账号、部门和直属负责人的同企业一致性由数据库守卫触发器保证，不能只依赖前端校验。

## 页面结构

### /people

1. `PageHeader`：标题“组织人事”，说明员工目录用途。
2. 员工统计：员工总数、在职人数、试用期人数、部门数量。
3. 搜索筛选：姓名/工号/邮箱搜索、部门筛选、员工状态筛选。
4. 员工列表：头像、姓名、工号、部门、岗位、直属负责人、入职日期、任职状态。
5. 点击员工行进入 `/people/[public_id]`。
6. 支持空目录和筛选无结果状态。

### /people/[id]

1. 员工详情头部：头像、姓名、工号、任职状态、部门、岗位。
2. 基本联系信息：工作邮箱、联系电话。
3. 任职信息：部门、岗位、直属负责人、用工类型、入职日期、离职日期。
4. 账号信息：账号是否开通、账号访问状态、已分配系统角色。
5. 返回员工列表。

V1 使用单页详情，不增加招聘、绩效、工资或复杂权限 Tab。

## 组件架构

复用现有：

- `WorkspaceShell`、`WorkspaceSidebar`、`WorkspaceHeader`
- `PageHeader`
- `GlassCard`
- `DataCard`
- `StatusBadge`
- `Avatar`
- `Table`
- `Input`
- `Select`
- `Button`
- `Empty`
- `MobileWorkspaceNav`

新增业务组件：

- `EmployeeStats`
- `EmployeeFilters`
- `EmployeeList`
- `EmployeeDetailHeader`
- `EmployeeBasicInfo`
- `EmployeeOrganizationInfo`
- `EmployeeAccountInfo`

页面组件只负责组合，筛选逻辑、Mock 数据和 Supabase 数据装配分别放在独立文件中。

## 数据策略

- migration 文件建立正式数据库边界。
- TypeScript 类型与数据库字段保持一致。
- Demo V1 使用关联完整的 Mock 数据。
- 数据装配函数预留 Supabase 接入；没有 Supabase 配置时整页回退 Mock，不混合真实身份和演示员工。
- `/people` 与 `/people/[id]` 使用同一份数据源契约。

## 测试范围

- migration 契约测试：表、关键字段、约束、索引和 RLS 存在。
- Mock 数据测试：部门、员工、账号和直属负责人关联完整。
- 员工列表测试：统计、搜索、部门筛选、状态筛选和详情链接。
- 员工详情测试：有效员工展示完整信息；无效 ID 返回 404。
- 响应式验证：桌面端无横向溢出，移动端列表和详情可读。

## 明确不做

- 招聘管理
- 绩效管理
- 薪资和工资计算
- 员工档案新增、编辑和删除 UI
- 部门管理页面
- 复杂字段级权限
- 批量导入导出
- 独立员工操作审计系统
