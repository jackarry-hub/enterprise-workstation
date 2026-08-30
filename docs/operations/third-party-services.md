# QuantXY 第三方服务清单

## Service inventory

| 服务 | 用途 | 数据 | 凭据位置 |
| --- | --- | --- | --- |
| Supabase | Postgres/Auth/Storage | 全部业务数据与文件 | 服务器秘密管理器 |
| 飞书开放平台 | OAuth、目录、事件、消息 | 企业身份/组织/必要消息 | 服务器秘密管理器 |
| DeepSeek | AI 推理 | 经授权的提示与必要上下文 | 服务器秘密管理器 |
| WAF/入口代理 | TLS、限流、防护 | 请求元数据 | 供应商控制面 |

## Failure behavior

Supabase 不可用时就绪 503 并停止业务；飞书失败进入有界重试/同步问题，不猜测身份；DeepSeek 超时/限流返回可重试状态并保留人工确认，不能回退假答案；Storage 校验失败删除未完成对象并记录审计。

## Data boundaries

坚持最小字段、最小保留和租户隔离。不得把薪资、私档、令牌或整库内容发送给 AI。Webhook 验签后才处理；日志与证据脱敏。跨境、DPA、隐私政策和数据保留由上线前法务确认。

## Exit plan

Supabase 以标准 Postgres/对象清单导出；飞书映射保留 external identity 与同步游标；AI Provider 通过服务端适配器替换并重跑评测；WAF 规则导出版本化。切换必须在 Staging 验证，无双写静默漂移。

