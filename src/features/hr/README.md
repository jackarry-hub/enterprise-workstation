# 组织人事

Demo V1 提供员工统计、员工目录、搜索筛选和员工详情，路由为 `/people` 与 `/people/[id]`。

## 模型边界

- `employee_profiles` 是员工档案主体，可独立于登录账号存在。
- `organization_members` 只负责企业账号成员关系，通过可空字段 `organization_member_id` 与员工档案关联。
- `roles` 只负责权限角色，不承载岗位、部门或员工状态。
- `departments` 负责企业内部部门树，部门、直属负责人和账号关联均由数据库校验企业边界。

## 数据策略

- 未配置 Supabase 时，目录和详情使用同一组完整关联的 Mock 数据。
- 配置 Supabase 后，服务端读取 `departments`、`employee_profiles`、`organization_members`、`member_roles` 与 `roles`。
- 客户端只保留纯筛选状态，不引入 Supabase 服务端依赖。

## V1 范围

包含员工统计、列表、搜索、部门/状态筛选和只读详情；不包含招聘、绩效、工资、档案编辑、部门管理页面与复杂权限管理。
