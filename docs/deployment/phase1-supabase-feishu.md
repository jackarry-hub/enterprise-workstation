# 量子星河第一阶段云端配置与员工开通手册

这份手册给系统管理员使用。按顺序逐项勾选即可，不需要理解 OAuth、RLS 或数据库内部实现。

## 先确认两个容易混淆的标识

- 当前系统只供“量子星河”这一家企业内部使用。名单里的 `tenantSlug` 固定为 `quantxy`，`organizationSlug` 固定为 `quantum-galaxy`。
- 数据库中的 `tenant_id` 和名单中的 tenant slug 是应用的数据隔离边界。现在只启用量子星河，预留这个边界是为了未来可以安全交付多企业 SaaS；第一阶段没有企业创建、选择或切换功能。
- `FEISHU_TENANT_KEY` 只是飞书登录服务返回的企业标识，用来确认登录者来自指定飞书企业。它不是应用的 `tenant_id`，也不能代替 tenant slug。

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
- [ ] 名单暂时没有 `union_id` 或 `open_id` 时，再申请读取企业邮箱所需权限；企业邮箱必须唯一，且只用于首次身份匹配。
- [ ] 记录 App ID、App Secret 和飞书 `tenant_key`。
- [ ] App Secret 只放服务器配置，不写入名单、文档、日志或前端代码。

预期结果：应用可以发起网页授权，并且只能获取完成登录所需的最少身份信息。

## 3. 准备可访问的 HTTPS 地址

- [ ] 为联调准备 Supabase 能访问的 HTTPS 地址，并填写 `NEXT_PUBLIC_APP_URL`。
- [ ] 不要把 `127.0.0.1` 或 `localhost` 登记为真实云端联调地址。
- [ ] 第一阶段可以使用受控的临时 HTTPS 测试域名转发到本机 3000 端口；第四阶段部署香港服务器后，再替换为正式域名。

在 Supabase Auth 新建自定义 OAuth2 Provider，逐项填写：

| 配置项 | 值 |
| --- | --- |
| Identifier | `custom:feishu` |
| Authorization URL | `https://accounts.feishu.cn/open-apis/authen/v1/authorize` |
| Token URL | `https://open.feishu.cn/open-apis/authen/v2/oauth/token` |
| UserInfo URL | `${NEXT_PUBLIC_APP_URL}/api/auth/feishu/userinfo` |
| Email optional | `true` |
| PKCE enabled | `true` |

预期结果：`custom:feishu` 已启用，邮箱不是登录必填项，PKCE 默认开启。

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
NEXT_PUBLIC_APP_URL=https://phase1.example.invalid
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace-with-publishable-key
SUPABASE_SERVICE_ROLE_KEY=replace-with-service-role-key
FEISHU_APP_ID=replace-with-app-id
FEISHU_APP_SECRET=replace-with-app-secret
FEISHU_TENANT_KEY=replace-with-feishu-tenant-key
PHASE1_ROSTER_PATH=private/phase1-roster.json
```

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
- 每名员工至少提供 `feishuUnionId`、`feishuOpenId`、唯一 `workEmail` 中的一项；不得重复。
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

## 7. 五岗位和拒绝场景验收

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

## 8. 检查日志和敏感信息

- [ ] Supabase Auth 日志只保留结果、时间和请求编号，不复制 Provider Token、授权码、Cookie、App Secret 或 `service_role`。
- [ ] 应用日志不打印完整员工名单、完整身份响应或环境变量。
- [ ] 数据库 `audit_logs` 能看到名单开通和身份认领结果，但 metadata 中没有 Secret、Token、授权码、Cookie、`service_role` 或原始 IP。
- [ ] 执行 `git status --short`，确认 `.env.local`、`private/` 和 `playwright/.auth/` 没有进入待提交文件。

## 当前尚未完成的外部验证

- 当前本机没有 Docker/Podman，因此 `supabase db reset` 和 pgTAP 数据库测试是 **NOT RUN — ENVIRONMENT BLOCKED**，不能写成已通过。
- 真实 Supabase 云项目、飞书 App 凭据和公司确认后的员工名单尚未提供；云端迁移、真实名单导入和五岗位飞书联调均待企业资料到位后按本手册执行。
- 本手册和代码不包含任何真实 Secret、Token 或真实员工数据。
