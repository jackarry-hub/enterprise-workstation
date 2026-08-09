# 企业工作站 Demo V0.9：系统设置设计说明

## 数据复用结论

现有 `organizations` 已包含企业名称、Logo 和时区；`employee_profiles` 与认证用户元数据可承载个人头像和资料；`roles`、`permissions`、`member_roles`、`role_permissions` 已为权限页预留稳定模型。因此本模块不新增 migration，避免为了界面创建重复设置表。

## 页面与交互

`/settings` 使用四个轻量 Tab：

1. 企业信息：企业名称、Logo、时区、企业成立日期与工作周设置。
2. 个人设置：头像、姓名、企业邮箱和密码更新入口。
3. 基础配置：通知渠道、系统语言、日期格式和界面偏好。
4. 权限设置：展示现有六类角色和后续权限矩阵入口，V0.9 明确标记为预留，不实现复杂授权。

输入、选择、开关和保存反馈在本地可交互，后续接入 Supabase 时不改变页面结构。视觉参考 `15_企业工作站_系统设置.png` 并复用已有 Workspace Layout、GlassCard、PageHeader、Tabs、Input、Select 与 Toggle。

## 验收

- 四个设置区域均可访问并切换。
- 企业 Logo 使用真实品牌资产，不使用占位图形。
- 通知开关与保存反馈可演示，权限页不产生越权写入。
- 桌面和移动端无横向溢出，页面测试、构建和视觉 QA 通过。
