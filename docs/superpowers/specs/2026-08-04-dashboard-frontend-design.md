# 企业工作站 Dashboard 前端阶段设计规格

## 已批准方向

本阶段沿用 `2026-08-03-enterprise-workstation-phase-one-design.md` 与已提供的首页驾驶舱设计稿，不重新设计信息架构。设计稿优先级高于通用后台模式，不引入默认管理模板、ERP 蓝色风格或额外业务页面。

## 技术与范围

- 固定使用 Next.js `15.5.22` 稳定版、App Router、TypeScript、React 19。
- 只交付前端页面，Dashboard 数据全部来自 `src/features/dashboard/data.ts` 的类型安全 mock 数据。
- 保留现有 Supabase 基础文件，但本阶段不新增、修改或调用后端业务能力。
- 不开发项目、任务、活动、人事、考勤、薪资、审批的详情页或业务流程；导航仅作为设计稿中的工作站框架展示。

## 页面结构

- 全局 Layout：白色与浅蓝背景、固定 Sidebar、吸顶 Header、移动端抽屉导航。
- 公共组件：`GlassCard`、`DataCard`、`StatusBadge`，并继续复用既有 `ProgressBar`、`PageHeader`。
- Dashboard 必须包含：企业员工、进行项目、今日任务、整体完成率、项目健康度、活动推进中心、通知公告、即将日程。
- 设计稿同时展示的任务趋势、待办事项、团队协作和项目动态属于驾驶舱辅助信息，保留在 Dashboard 内，不视为其他业务模块开发。

## 视觉与响应式

- 桌面验收画布为 `1672 x 941`，参考 `docs/design-reference/02_企业工作站_首页驾驶舱.png`。
- 保持真白背景、浅蓝空间渐变、半透明卡片、柔和阴影、大圆角和紧凑企业数据密度。
- 左上品牌区只保留设计稿允许的 Logo 与“企业工作站”，移除设计稿中没有的英文副标。
- `390 x 844` 移动端必须单列展示、无横向溢出，Sidebar 通过抽屉打开。

## 验收

- `npm run test`、`npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- 使用生产服务完成桌面和移动端浏览器验证，控制台无应用错误或警告。
- 对设计稿和最终截图进行同轮 `view_image` 对比，并展示最终截图。
