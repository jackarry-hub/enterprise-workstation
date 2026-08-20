# 量子星河第一阶段云端配置与员工开通手册

这份手册给系统管理员使用。按顺序逐项勾选即可，不需要理解 OAuth、RLS 或数据库内部实现。

## 上线切换顺序（唯一准则）

下面 A 到 F 是任务通知上线的唯一顺序；后续章节只补充每一步的操作细节，不得提前扩大全员可用范围。

### A. 飞书能力配置（不向全员开放）

- 在飞书后台配置网页应用登录、机器人能力和 `im:message:send_as_bot` 权限，但暂不向全员开放。

### B. 部署代码、HTTPS APP URL 与运行时秘密

- 部署本次代码到单个 Next.js 实例，配置员工可访问的 HTTPS `NEXT_PUBLIC_APP_URL`，并通过部署平台注入服务器运行时秘密。

### C. 应用数据库迁移

- 对目标 Supabase 项目应用本次数据库迁移，再导入并核对测试员工身份和有效的飞书 `open_id`。

### D. 限定测试范围

- 如果真实消息发送必须先发布版本，只发布包含机器人能力和消息权限的测试版本，并将应用可用范围限定为指定测试员工；此时不得覆盖所有会接收任务的员工。

### E. 指定员工验收

- 由指定测试员工完成真实任务消息、登录回跳、任务详情和领取验收；任一项未通过都不得扩大范围。

### F. 验收后扩大全员

- 只有指定员工验收全部通过后，才正式发布或将应用可用范围扩大到所有会接收任务的员工。

## 先确认两个容易混淆的标识

- 当前系统只供“量子星河”这一家企业内部使用。名单里的 `tenantSlug` 固定为 `quantxy`，`organizationSlug` 固定为 `quantum-galaxy`。
- 数据库中的 `tenant_id` 和名单中的 tenant slug 是应用的数据隔离边界。现在只启用量子星河，预留这个边界是为了未来可以安全交付多企业 SaaS；第一阶段没有企业创建、选择或切换功能。
- `FEISHU_TENANT_KEY` 只是飞书登录适配器在服务器端用来核对来源企业的 Provider 标识。它不是应用的 `tenant_id`，也不能代替 tenant slug。

## 1. 创建 Supabase 项目

- [ ] 在 Supabase 新建项目，区域选择 **Singapore（新加坡）**，套餐选择 **Pro**。
- [ ] 在 Auth 登录方式设置中关闭邮箱/密码自助注册。
- [ ] 关闭匿名登录和匿名用户创建。
- [ ] 记录项目 URL、publishable key 和 `service_role` key。
- [ ] 确认 `service_role` 只放在服务器的环境配置或本地管理员命令中，不放入浏览器、不截图、不发群聊、不提交 Git。

预期结果：Supabase 项目可用，普通员工无法使用邮箱密码或匿名方式自行注册。

## 2. 创建量子星河飞书企业自建应用

- [ ] 在飞书开放平台创建“企业自建应用”，所属企业选择量子星河。
- [ ] 启用网页应用登录并申请读取基础身份信息所需权限。
- [ ] 启用机器人能力，并申请 `im:message:send_as_bot` 权限。
- [ ] 名单暂时没有 `union_id` 或 `open_id` 时，再申请读取企业邮箱所需权限；企业邮箱必须唯一，且只用于首次身份匹配。
- [ ] 记录 App ID、App Secret 和飞书 `tenant_key`。
- [ ] 此时只完成能力和权限配置，不向全员开放；需要为真实消息发布版本时，按第 6.5 节仅开放指定测试范围。
- [ ] App ID 只由通知服务在服务器运行时读取；App Secret 只放服务器运行时配置，不写入名单、文档、日志、构建参数或前端代码。

预期结果：网页授权、机器人能力和最小权限已经配置，但应用尚未向全员开放。

## 3. 部署代码并准备可访问的 HTTPS 地址

- [ ] 将本次代码部署到单个 Next.js 实例；先保持低并发，不启用多实例并行消费或自动重试。
- [ ] 生产环境将 `NEXT_PUBLIC_APP_URL` 设置为员工能从浏览器访问的最终部署 origin，例如 `https://workstation.example.com`；该值会在构建时嵌入，并用于生成飞书任务深链。
- [ ] `NEXT_PUBLIC_APP_URL` 只填写 origin，不附带路径、查询参数或片段；更换正式域名后重新构建并部署应用。
- [ ] 通过部署平台注入 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`SUPABASE_SERVICE_ROLE_KEY` 和 `FEISHU_TENANT_KEY`；秘密只存在于服务器运行时，不进入构建参数或客户端资源。
- [ ] 不要把 `127.0.0.1` 或 `localhost` 登记为真实云端联调地址。
- [ ] 第一阶段可以使用受控的临时 HTTPS 测试域名转发到本机 3000 端口；第四阶段部署香港服务器后，再替换为正式域名。

在 Supabase Auth 新建自定义 OAuth2 Provider，逐项填写：

| 配置项 | 值 |
| --- | --- |
| Identifier | `custom:feishu` |
| Client ID | 飞书企业自建应用的 App ID |
| Client Secret | 飞书企业自建应用的 App Secret |
| Authorization URL | `https://accounts.feishu.cn/open-apis/authen/v1/authorize` |
| Token URL | `https://open.feishu.cn/open-apis/authen/v2/oauth/token` |
| UserInfo URL | `${NEXT_PUBLIC_APP_URL}/api/auth/feishu/userinfo` |
| Email optional | `true` |
| PKCE enabled | `true` |

用于登录的 Supabase 自定义 Provider 仍需填写 App ID 和 App Secret。任务通知服务还会在 Next.js 服务器运行时分别读取 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`：App ID 是服务端运行时配置；App Secret 是仅服务端、仅运行时的秘密，不得添加 `NEXT_PUBLIC_` 前缀、作为镜像构建参数、发送到客户端或写入日志。

预期结果：`custom:feishu` 已启用，飞书 App ID/App Secret 已分别配置为 Client ID/Client Secret，邮箱不是登录必填项，PKCE 默认开启。

## 4. 登记回调地址

- [ ] 复制 Supabase Provider 页面显示的只读 Callback URL，原样登记到飞书应用的重定向地址中。
- [ ] 把 `${NEXT_PUBLIC_APP_URL}/auth/callback` 加到 Supabase 的 Redirect URLs。
- [ ] 检查两边都使用 HTTPS，域名、路径和大小写完全一致。

预期结果：员工完成飞书授权后能回到系统，不会停留在回调错误页。

## 5. PKCE 只允许有证据地降级

保持 `pkce_enabled=true`。只有真实联调明确返回飞书“不支持 `code_challenge` / `code_verifier`”的错误时，才执行以下操作：

- [ ] 保存不含授权码、Token、Cookie 的错误截图，并记录发生时间和请求编号。
- [ ] 仅对 `custom:feishu` 设置 `pkce_enabled=false`。
- [ ] 在验收记录中注明原因和证据。

没有上述证据，不得关闭 PKCE。

## 6. 执行迁移并导入员工名单

### 6.1 环境配置

在项目根目录创建本地 `.env.local`。下面只填写自己的真实值，不要把文件提交 Git：

```dotenv
NEXT_PUBLIC_APP_URL=https://workstation.example.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-publishable-key
FEISHU_APP_ID=cli_your_feishu_app_id
FEISHU_APP_SECRET=your_server_only_feishu_app_secret
SUPABASE_SERVICE_ROLE_KEY=your_server_only_supabase_service_role_key
FEISHU_TENANT_KEY=replace-with-feishu-tenant-key
PHASE1_ROSTER_PATH=private/phase1-roster.json
```

以上全部是明显的占位示例，不得复制任何真实密钥到文档或 Git。`NEXT_PUBLIC_APP_URL` 是客户端公开、构建时嵌入的最终部署 origin；`FEISHU_APP_ID` 由通知服务在服务器运行时读取。`FEISHU_APP_SECRET` 和 `SUPABASE_SERVICE_ROLE_KEY` 必须通过部署平台的服务器运行时秘密配置注入，不能添加 `NEXT_PUBLIC_` 前缀、不能用作镜像 build arg，也不能出现在客户端资源中。

这里保留 `FEISHU_TENANT_KEY`，因为 `/api/auth/feishu/userinfo` 的服务器端适配器会用它拒绝其他飞书企业。它仍然只是飞书 Provider 标识，不是量子星河应用的 tenant slug 或数据库 `tenant_id`。

### 6.2 推送数据库迁移

由管理员在项目根目录执行：

```powershell
npx supabase login
npx supabase link --project-ref <Supabase 页面中的 Project Ref>
npx supabase db push
```

预期结果：命令显示迁移已应用。不要把命令输出中的连接信息复制到公开聊天或工单。

### 6.3 准备安全名单

创建 `private/phase1-roster.json`。`private/` 已被 Git 忽略。下面全部是虚构示例，必须替换成经公司确认的员工资料；名单不得包含密码、App Secret、`service_role`、授权码或 Token。

```json
{
  "tenantSlug": "quantxy",
  "organizationSlug": "quantum-galaxy",
  "providerCode": "feishu",
  "employees": [
    {
      "employeeNo": "QXY-EXAMPLE-001",
      "displayName": "示例负责人（虚构）",
      "departmentCode": "AI",
      "jobTitle": "负责人",
      "roleCode": "owner",
      "feishuUnionId": "on_replace_owner",
      "feishuOpenId": "ou_replace_owner",
      "skills": ["strategy", "leadership"]
    },
    {
      "employeeNo": "QXY-EXAMPLE-002",
      "displayName": "示例经理（虚构）",
      "departmentCode": "AI",
      "jobTitle": "部门负责人",
      "roleCode": "department_head",
      "feishuOpenId": "ou_replace_manager",
      "skills": ["project management"]
    },
    {
      "employeeNo": "QXY-EXAMPLE-003",
      "displayName": "示例员工（虚构）",
      "departmentCode": "OPS",
      "jobTitle": "运营专员",
      "roleCode": "employee",
      "workEmail": "replace.employee@example.invalid",
      "skills": ["content"]
    },
    {
      "employeeNo": "QXY-EXAMPLE-004",
      "displayName": "示例财务（虚构）",
      "departmentCode": "FIN",
      "jobTitle": "财务",
      "roleCode": "finance",
      "feishuOpenId": "ou_replace_finance"
    },
    {
      "employeeNo": "QXY-EXAMPLE-005",
      "displayName": "示例人事（虚构）",
      "departmentCode": "HR",
      "jobTitle": "HRBP",
      "roleCode": "hr",
      "feishuOpenId": "ou_replace_hr",
      "skills": ["people operations"]
    }
  ]
}
```

名单规则：

- 岗位只能是 `owner`、`department_head`、`employee`、`finance`、`hr`。
- 部门代码使用 `AI`、`ECOM`、`OPS`、`FIN`、`HR`。
- 每名员工至少提供 `feishuUnionId`、`feishuOpenId`、唯一 `workEmail` 中的一项；不得重复。只填邮箱时，必须确认飞书身份接口能返回该格式有效的企业邮箱；未验证或格式异常的邮箱不会被用于身份认领。
- `skills` 可省略，最多 30 项；每项 1–40 个字符。工具会去除首尾空格、把英文转为小写并去重，不合法数据会直接拒绝。

### 6.4 导入名单

先检查工具，再执行导入：

```powershell
npm run phase1:provision:test
npm run phase1:provision
```

成功时只显示人数和工号，例如：

```text
员工名单导入完成：5 人（QXY-EXAMPLE-001、QXY-EXAMPLE-002、QXY-EXAMPLE-003、QXY-EXAMPLE-004、QXY-EXAMPLE-005）
```

相同名单可以重复执行；通用 `provision_employee_identity` 会按既有员工身份更新，不重复创建员工。工具只在本地管理员命令中使用 `service_role`，浏览器页面不会接触该密钥。

### 6.5 启用任务通知并确认部署边界

- [ ] 确认第 2 节的机器人能力和 `im:message:send_as_bot` 权限已配置，第 3 节的代码、HTTPS origin 和运行时秘密已部署，第 6.2 节迁移已应用。
- [ ] 确认指定测试员工的身份已经同步有效的 `open_id`；只有邮箱或 `union_id`、尚无 `open_id` 的员工不能接收机器人任务消息。
- [ ] 如果真实消息发送必须先发布版本，则只发布测试版本，并将应用可用范围限定为指定测试员工（五岗位验收时可各指定 1 名）；不得提前覆盖全员。
- [ ] 使用最终部署 origin 重新构建应用，并从指定测试员工浏览器确认任务深链可访问；不要把本地地址当作生产 origin。
- [ ] 确认 App ID 只在服务器运行时使用，App Secret 和 `service_role` 只存在于服务器运行时秘密配置中。

当前阶段只支持单个 Next.js 实例、低并发的请求内通知投递，不支持多实例并行消费或自动重试。`task_notifications` 记录投递状态，但当前还不是带跨实例 claim/lease 的完整 outbox worker；飞书已接收消息而数据库回写失败时会留下 `delivery_unconfirmed`，盲目重试可能产生重复消息。遇到该状态时先由管理员在飞书侧确认，再决定是否手动重试。扩大为多实例生产部署前，需要单独评审并补齐 outbox 并发领取、幂等和恢复机制；本阶段不扩展这些实现。

## 7. 五岗位和拒绝场景验收

- [ ] 给指定测试员工创建一条真实任务，确认只收到 1 条飞书机器人消息。
- [ ] 在未登录状态点击消息中的任务深链，完成飞书登录后回跳到同一任务。
- [ ] 确认任务详情中的标题、项目、汇报人、优先级、截止日期和验收标准正确。
- [ ] 点击领取任务，确认领取成功且任务状态正确更新；只打开 GET 深链时不得自动领取。
- [ ] CEO 员工登录后进入老板驾驶舱。
- [ ] 管理层员工登录后进入部门推进台。
- [ ] 普通员工登录后进入自己的执行台。
- [ ] 财务员工登录后进入财务中心。
- [ ] 人事员工登录后进入人事中心。
- [ ] 不在名单中的飞书员工被拒绝，并看到联系管理员的简短说明。
- [ ] 将测试员工设为 suspended 后重新登录，系统拒绝进入工作台。
- [ ] 将测试员工设为 departed 后重新登录，系统拒绝进入工作台。
- [ ] 点击退出后，再直接打开任一工作台地址，系统回到登录页。

预期结果：五个岗位各自进入正确首页；未知、停用、离职用户不能进入；退出后会话失效。

## 8. 验收后扩大全员

- [ ] 只有第 7 节真实消息、登录回跳、任务详情、领取和岗位验收全部通过后，才将应用可用范围扩大到所有会接收任务的员工。
- [ ] 如果测试范围无需发布版本，此时才正式发布；如果已经发布测试范围版本，则核对同一已验收版本后再扩大全员范围。
- [ ] 确认新增接收员工均已同步有效的飞书 `open_id`，再开始正式任务通知。

## 9. 检查日志和敏感信息

- [ ] Supabase Auth 日志只保留结果、时间和请求编号，不复制 Provider Token、授权码、Cookie、App Secret 或 `service_role`。
- [ ] 应用日志不打印完整员工名单、完整身份响应或环境变量。
- [ ] 数据库 `audit_logs` 能看到名单开通和身份认领结果，但 metadata 中没有 Secret、Token、授权码、Cookie、`service_role` 或原始 IP。
- [ ] 执行 `git status --short`，确认 `.env.local`、`private/` 和 `playwright/.auth/` 没有进入待提交文件。

## 当前尚未完成的外部验证

- 当前本机没有 Docker/Podman，因此 `supabase db reset` 和 pgTAP 数据库测试是 **NOT RUN — ENVIRONMENT BLOCKED**，不能写成已通过。
- 真实 Supabase 云项目、飞书 App 凭据和公司确认后的员工名单尚未提供；云端迁移、真实名单导入和五岗位飞书联调均待企业资料到位后按本手册执行。
- 本手册和代码不包含任何真实 Secret、Token 或真实员工数据。
