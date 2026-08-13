# Design QA — AI 决策调度台

## 对比基准

- source visual truth path: `C:\Users\Djy\Documents\企业工作站\artifacts\reference\quantxy-ai-scheduling-empty.png`
- implementation screenshot path: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\10-implementation-draft-final.png`
- generated-state screenshot path: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\14-implementation-review-final.png`
- full-view comparison evidence: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\11-combined-comparison-final.png`
- focused-region comparison evidence: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\12-focused-comparison-final.png`
- viewport: in-app Browser，CSS viewport 约 `895 × 662`
- source pixels: `1270 × 712`。参考 HTML 使用固定宽度侧栏与桌面最小内容宽度，因此在相同浏览器窗口中产生横向溢出并输出更宽的页面像素。
- implementation pixels: `895 × 662`，响应式适配到当前 CSS viewport，无页面级横向溢出。
- density normalization: 两者均为浏览器 1x 截图；并排比较时使用等宽容器和 `object-fit: contain`，重点区域比较保留原始像素并分别裁取目标输入区域。
- state: 决策输入完成、AI 尚未拆解；另验证 AI 拆解后的责任方案状态。

## 最终检查

### 字体与排版

- 两者均使用中文系统无衬线字体栈；实现沿用现有工作站字体和字重体系。
- 实现将页面标题提升为更明确的一级标题，并通过较紧凑的副标题、步骤条和 11–14px 辅助文本维持扫描层级。
- 长目标文本在输入区保持可读行高；部门、人员、截止日期和状态均有稳定的截断或换行策略。

### 间距与布局节奏

- 参考页的三列输入/WBS/人员结构被有意改为“固定输入列 + 自适应结果列”，符合用户要求的精简页面。
- 当前视口下，目标、约束和主 CTA 完整出现在首屏；AI 能力说明与后续责任结果在右侧展开。
- 生成状态的指标、责任链和部门卡均约束在自适应网格中；最终截图未出现页面级横向滚动。

### 颜色与视觉令牌

- 使用现有工作站的 `primary / brand-soft / success / warning` 令牌，对应参考页的蓝、紫、绿、橙状态色。
- 卡片边框、浅色背景和阴影维持参考页的轻量企业 SaaS 质感，并控制了卡片数量和层级。
- 正文、辅助文案和状态徽标对比度清晰，无发现影响阅读的低对比组合。

### 图片与资产质量

- 核心流程不需要新增位图资产；所有功能图标使用项目既有 Lucide 图标库，笔画、尺寸和对齐一致。
- 参考页固定侧栏中的品牌图标在当前 895px 响应式视口由现有移动导航替代；大屏侧栏仍保留项目原有 QuantXY 品牌资产。这是响应式约束，不是资产缺失或替换。

### 文案与内容

- 文案从参考页的泛化“AI 调度”收敛为“决策人输入 → 部门目标 → 个人任务 → 结果回流”。
- 每项任务包含唯一负责人、部门归口、截止时间、依赖和可判定验收标准；任务中心使用“AI 下发”标识。
- 页面可独立理解，没有暴露实现提示或用户原始需求文本。

### 交互、响应式与可访问性

- 已实测：输入目标、AI 拆解、打开个人任务详情、确认下发、任务中心识别、任务状态更新、首页结果回流。
- 表单均有可访问标签；步骤使用列表和 `aria-current`；任务卡、CTA、对话框均可通过语义角色定位。
- 当前视口和生成状态均无内容重叠、主要操作裁切或页面级横向溢出。
- 浏览器控制台已检查。构建期间曾因在运行中的 dev server 上执行生产构建产生一次历史 webpack 热更新错误；重启 dev server 后未再出现新的运行时错误。

## 对比迭代记录

1. 初始实现
   - finding: `[P2]` 当前 895px 视口落入单列布局，AI 说明区和主 CTA 均落在首屏下方。
   - fix: 将工作台主区域提前切换为双列，保持输入列固定、结果列自适应。
   - post-fix evidence: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\03-implementation-draft-revised.png`。

2. 首次并排比较
   - finding: `[P2]` 主 CTA 仍未完整出现在首屏，输入卡相对参考页偏高。
   - fix: 压缩页标题、步骤条和表单节奏；将约束改为紧凑单行输入；保留完整目标文本；缩短主按钮高度。
   - post-fix evidence: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\10-implementation-draft-final.png` 与 `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\11-combined-comparison-final.png`。

3. 生成状态检查
   - finding: `[P2]` 责任链的最小内容宽度撑大结果列，生成状态出现页面级横向滚动。
   - fix: 为结果根容器和责任链卡补充 `min-w-0`，把横向滚动限制在责任链自身的可滚动区域。
   - post-fix evidence: `C:\Users\Djy\Documents\企业工作站\artifacts\design-qa\14-implementation-review-final.png`。

## Findings

- 无剩余 P0、P1 或 P2 问题。
- `[P3]` 当前紧凑约束输入在较窄宽度下仅显示前半段文字；点击或键盘聚焦后仍可编辑完整内容，可在后续按需要增加展开式高级约束编辑。

## Implementation Checklist

- [x] 目标、截止期、预算、约束输入
- [x] AI 部门与个人责任拆解
- [x] 唯一负责人、依赖和验收标准
- [x] 确认后写入现有项目/任务仓库
- [x] 任务中心 AI 来源标识和状态更新
- [x] 执行结果回流到决策台
- [x] 当前桌面/平板视口无页面级横向溢出
- [x] 类型、单元测试、Lint 与生产构建验证

final result: passed

## 2026-08-13 全局交互与无关信息复检

- target flow: 首页 / 任务 / 项目 / 审批 / 我的 → 点击主要入口 → 到达对应办理页或产生明确状态变化。
- decision assignment: 决策下发后的候选人卡不再使用不可点击的“已下发锁定”；未提交验收的任务可由 CEO 改派，改派结果同步到项目、个人任务和执行台；CEO 不进入执行候选人列表。
- personal workspace: 员工、部门负责人、财务与人事工作台移除“最近流转”泛化动态，只保留当前人员负责的任务和必要办理入口。
- action semantics: 无数据时不展示“活动日历 / 创建活动”等不可用按钮；已成交客户用状态徽标而不是禁用按钮；通知全部已读后隐藏批量操作；“我的考勤”直达个人考勤视图。
- route audit: 静态业务入口均对应现有路由；未发现 `href="#"`、`javascript:` 或空 `onClick`。
- interaction tests: 覆盖候选人改派、员工任务隔离、任务直达、审批详情、考勤个人视图、通知清零、客户完成状态与个人功能入口。

final result: passed

## 2026-08-13 移动端全局版面与流程复检

- reference images:
  - `C:\Windows\TEMP\codex-clipboard-3bd16fd3-7ea9-4e87-939c-d7607767e896.png`
  - `C:\Windows\TEMP\codex-clipboard-50409d08-918b-41ba-8261-803babd8b335.png`
  - `C:\Windows\TEMP\codex-clipboard-9eddb7b5-3cff-4026-93a5-f0af6899ae62.png`
- rendered verification: Codex 内置浏览器打开 `http://localhost:3010/dashboard`、`/decision`、`/payroll` 与审批详情；生产构建后重新启动本地服务；未使用未经授权的 Playwright。`127.0.0.1` 在内置浏览器出现重定向缓存，改用同源 `localhost` 完成实机检查。
- native-size checks: 430px 应用框；补充 359px 以下降级规则。
- comparison points:
  1. 审批申请人和当前负责人改为并排横向信息卡，不再出现姓名、部门和职位逐字竖排。
  2. 提交时间与状态独立占据整行，避免三列压缩造成信息堆叠。
  3. 薪资三项统计统一为单行三等分卡片，金额保留完整值提示，不再形成两上一次的空洞布局。
  4. CEO 首页恢复高优先级 AI 决策调度入口，其他角色不显示；入口与落地页主题一致。
  5. 首页考勤入口直达个人考勤视图，避免进入管理概览后文不对题。
  6. 任务页原“发起任务”图标实际跳转项目页，已改为“查看项目”，消除按钮语义与落地页不一致。
  7. 全局导航与帮助页的“AI 决策调度台”统一指向 `/decision`，不再错误落回普通首页。
- copy diff: 首页新增“CEO 专属 / AI 决策调度台 / 输入目标，AI 拆解部门与个人任务”；其余文案保持业务含义不变。
- deviations: AI 决策台保留现有完整数据与交互，只将步骤、能力卡与主工作区重新压缩为移动端结构，没有删除总线能力。
- mismatches fixed: 审批信息挤压、薪资卡片错位、CEO 决策入口缺失、考勤入口落地不匹配、任务页入口文不对题、全局 AI 决策入口地址错误。
- core flow verification: 十人任务从 0% 独立执行、上传、提交、验收至 100%；CEO 总验收与归档；薪资五节点；考勤、人事与通知回写均由自动化用例验证。

final result: passed

## 2026-08-13 单网址与演示身份复检

- deployment model: 电脑端与手机端继续使用同一套 Next.js 路由和业务数据；手机宽度自动使用移动端信息层级，不建立第二个网站。
- demo roster: 保留 10 位演示人员；四种岗位仅作为四类工作台与权限模板，不缩减人员。
- identity switcher: 移除浏览器原生下拉，改为移动端底部人员面板；显示姓名、岗位、部门和当前身份状态，选择后进入该人员正确的岗位落地页。
- role workspace: 岗位头部在手机端压缩为身份卡、上下游摘要和四项横向状态条；行动区改为单列整行点击，按红/橙/蓝优先级展示，最多四项。
- isolation: 每个人只显示自己的执行任务与工资；负责人额外显示职责范围内的验收事项，执行区和验收区不混合。
- automated verification: 83 个测试文件、565 项测试全部通过；TypeScript、ESLint 与 CUSTOMER_DEMO_MODE 生产构建通过。
- supported routes: 构建生成 10 条工资单详情与 10 条人员详情静态路径。

final result: passed
