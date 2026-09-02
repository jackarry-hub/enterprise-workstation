# Agent 中心外部工作流接入合同

## 当前范围

QuantXY 只登记已经从现有前端确认的六个工作流：

- `family-portrait`
- `ai-automatic-video-editing`
- `tarot-lead-video`
- `daoist-interpretation-video`
- `digital-human-talking-video`
- `palmistry-reading-video`

工作流卡片始终保留原中控台入口；只有服务端健康检查成功时才允许在 Agent 中心直接运行。

## AI 影像制作中心

固定域名：`https://studio.quantumgalaxy.top`

已从线上前端确认的接口：

- `GET /api/image-studio/catalog`
- `GET /api/image-studio/jobs`
- `POST /api/image-studio/jobs`
- `POST /api/image-studio/jobs/{jobId}/regenerate`

QuantXY 使用 `GET /api/image-studio/catalog` 验证服务令牌，并使用 `POST /api/image-studio/jobs` 提交 `multipart/form-data`：

- `workflowKey=family-portrait`
- `promptOverride`
- `size=1536x1024|1024x1536|1024x1024`
- 一个至八个 `images`

影像制作中心需要在不改变现有 Cookie 登录的前提下，额外支持服务端 `Authorization: Bearer <token>`，并把令牌绑定到正确的企业空间。不能接受浏览器传来的租户 ID 作为授权依据。

## 前端内容工作台

固定域名：`https://content.quantumgalaxy.top`

线上前端目前能读取工作流目录，并能把五个已知工作流导航到对应制作页面；其他登记项仍显示“执行前端待接入”。为了让 QuantXY 原生调用，需要补充下面的服务端合同：

### 连接验证

`GET /api/integrations/v1/workflows`

要求：验证 Bearer 服务令牌，返回当前企业空间允许调用的工作流，不返回密钥、内部提示词或存储地址。

### 创建运行

`POST /api/integrations/v1/workflows/{workflowKey}/runs`

请求：

```json
{
  "workflowKey": "digital-human-talking-video",
  "input": "用户确认的任务目标和制作要求"
}
```

成功响应必须包含至少一个稳定标识：`runId`、`jobId`、`taskId` 或 `id`。推荐：

```json
{
  "runId": "stable-upstream-id",
  "status": "queued"
}
```

## 安全和运行约束

- 服务令牌只配置在 QuantXY 服务端：`QUANTXY_IMAGE_STUDIO_SERVICE_TOKEN`、`QUANTXY_CONTENT_WORKFLOW_SERVICE_TOKEN`。
- 上游域名和路径在代码中固定，禁止用户提交任意 URL。
- 跳转被禁用，单次连接验证超时五秒，运行提交超时三十秒，响应上限 1MB。
- 图片限制为 JPG、PNG、WebP；校验 MIME、文件头、单文件 12MB、合计 48MB。
- 每次提交先写入租户、组织、成员和幂等键绑定的运行记录，再调用上游；成功和失败都写审计。
- 当前“成功”表示上游已接受任务，不代表异步生成已经完成。成品完成回调和状态同步必须在上游提供查询/回调合同后再开放。

## 部署门槛

迁移 `202609020004_external_workflow_runtime.sql`、两个服务令牌和两个上游健康检查全部通过之前，Agent 中心必须显示“待配置”或“连接未验证”，不得显示“可直接运行”。
