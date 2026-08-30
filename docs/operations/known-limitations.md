# QuantXY 已知限制

## Current blockers

截至 2026-08-30，本机无 Docker，真实数据库迁移/RLS、容器、浏览器全旅程、负载、OAuth/Storage/WAF、真机和恢复演练尚未执行。`dashboard/department/execution/finance/hr/projects/activities/tasks/payroll/customers` 仍由 `commercialReady=false` 隔离。融合预览资产仍存在，未获证据闭环授权不得删除。

## Excluded scope

请假与考勤暂不属于公开产品；历史表/迁移保留但无导航、页面或可调用正式入口。客户导入正式接口当前接收 JSON 数组；`customers.csv` 是字段映射/数据准备模板，需经受控转换为 JSON 后导入。员工 XLSX 是受控初始化模板，不允许浏览器直接绕过管理员导入流程。

## Release impact

上述任一 Current blocker 存在时最终 `npm run verify:commercial` 必须返回 BLOCKED，不能宣称商用可用。可先进行有限内部试用的模块必须使用真实 Staging 数据、限定成员和明确回滚；不得把本地静态通过等同上线。

