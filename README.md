# 量子星河企业工作站

面向决策人、部门负责人、员工、财务和人事的一体化企业协同工作站。系统以“领导输入问题 → AI 拆解 → 部门与个人执行 → 成果验收 → 风险升级 → 总验收归档”为主线，同时覆盖项目、活动、审批、考勤、请假、薪资、客户和组织管理。

## 当前交付状态

- 决策、项目、任务和个人执行共用同一份任务状态。
- 前置依赖、成果上传、负责人验收、SLA 与领导升级均已生效。
- 请假、补卡、加班、考勤封账和薪资发放执行职责分离。
- 项目甘特图、文件上传下载、日报和复盘均可实际操作并保存。
- 顶部通知、行动清单和领导周报从真实业务状态自动生成。
- 五类岗位采用独立导航和直接访问权限校验。
- 本地交付版使用浏览器持久化数据；配置 Supabase 后可接入云端数据与文件。

完整操作说明见 [企业工作站使用说明](docs/企业工作站使用说明.md)。

## 本地运行

    npm install
    npm run dev -- -p 3007

打开 http://localhost:3007 。生产模式：

    npm run build
    npm start -- -p 3007

## 质量检查

    npm run typecheck
    npm run lint
    npm test -- --run
    npm run build

## 数据说明

- 业务数据：浏览器 localStorage
- 设置：浏览器 localStorage
- 上传文件：浏览器 IndexedDB
- 可选云端：Supabase 数据库、Auth 与 Storage

清除浏览器站点数据会删除本地业务记录和本地上传文件。正式部署前请配置企业账号、数据库备份和对象存储策略。

## Docker 生产部署

项目使用 Next.js standalone 输出和非 root 运行用户。先复制环境变量示例并填写真实值，文件名必须保留为本地文件，不得提交 Git：

    Copy-Item .env.example .env.production.local

生产构建与启动：

    docker compose --env-file .env.production.local up -d --build

默认映射到宿主机 `3000` 端口，可在本地环境文件中通过 `APP_PORT` 修改。所有 `.env*` 文件均被排除在 Docker 构建上下文之外，密钥只在容器运行时注入；`NEXT_PUBLIC_*` 变量属于前端公开配置，会在镜像构建阶段写入客户端资源。
