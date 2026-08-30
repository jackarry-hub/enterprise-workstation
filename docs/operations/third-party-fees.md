# QuantXY 第三方费用说明

## Cost owners

Platform 负责 Supabase/容器/WAF，IAM 负责飞书应用，AI Owner 负责 DeepSeek，业务 Owner 负责消息、存储和数据保留带来的增量。上线前必须登记实际套餐与发票主体。

## Fee model

Supabase 按数据库、带宽、Storage/Auth；飞书按企业应用能力和可能的消息/接口政策；DeepSeek 按输入/输出 token；入口与容器按实例、流量和日志。价格会变化，本文不写不可验证金额，以供应商合同/控制台为准。

## Budget controls

设置月预算、80%/100% 告警、AI 每租户/用户预算与并发、Storage 生命周期、日志保留、导出限额和 Agent kill switch。超预算默认阻止新高成本任务，不影响审计和管理员处置。

