# QuantXY 商用发布检查表

所有项目必须绑定同一个候选提交和迁移哈希；任一项为 `BLOCKED` 或失败时不得部署。

- [ ] 正式页面不存在 Mock、fixture、IndexedDB/localStorage 业务仓库和已排除的请假/考勤入口。
- [ ] `npm ci`、类型、Lint、生产构建、单元测试、覆盖率和依赖/密钥扫描通过。
- [ ] 隔离数据库完成 clean reset、重复 seed、迁移 dry-run、全部 pgTAP/RLS、审计不可变和回滚演练。
- [ ] owner、admin、supervisor、department_head、employee、hr、finance 七种身份和第二租户隔离通过。
- [ ] 桌面与模拟移动端完成组织、项目/任务、客户、审批/费用、薪资、知识、AI、Agent、分析和设置全旅程，失败数为 0。
- [ ] 真机 iOS/Android 完成导航、表单、键盘、上传、弱网、离线/恢复和无横向溢出验证。
- [ ] 飞书授权、目录同步、事件验签、消息发送/失败重试有真实 Staging 证据。
- [ ] DeepSeek 成功、超时、限流、费用记录、人工确认和降级失败态有真实 Staging 证据。
- [ ] Supabase Storage 上传、校验、下载授权、过期 URL 和清理任务有真实 Staging 证据。
- [ ] WAF 证据候选/配置哈希一致且由 Staging Owner 完成 Ed25519 验签。
- [ ] 容器非 root、只读根文件系统、能力集为空、资源限制、就绪 503/200 切换均已验证。
- [ ] 备份 ID、恢复结果、RPO/RTO、回滚版本和 canary 观测均已记录。
- [ ] 证据清单 `failed=0`，提交、迁移、命令、时间和制品路径完整。
- [ ] 发布负责人签字并单独给出生产上线授权。

当前本机无 Docker，因此数据库、浏览器真实闭环、镜像和 Staging 项目保持 `BLOCKED`；静态通过不能替代上述证据。
