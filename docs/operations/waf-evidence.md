# WAF 证据契约

当前状态：`BLOCKED`。仓库不内置、也不伪造 WAF 已启用证据；只能由获授权的 Staging Owner 在候选版本部署到隔离 Staging 后签发。

证据 JSON 必须包含：

- `provider`：实际 WAF 供应商标识。
- `rules`：已启用规则 ID 与动作；至少包括通用攻击拦截和登录限流。
- `environment`：必须为 `staging`。
- `candidate`：40 位候选提交哈希。
- `operator`：操作者 ID，角色必须为 `staging_owner`。
- `timestamps`：测试开始、完成时间，完成时间不得早于开始时间。
- `results`：与每条规则一一对应且均为 `passed` 的真实探测结果。
- `configHash`：导出并规范化后的 WAF 配置 SHA-256。
- `signature`：Staging Owner 的 Ed25519 签名、密钥 ID 和算法。

验签时必须从发布控制面另行提供预期候选哈希、预期配置哈希和已登记的 Owner 公钥。任何字段缺失、候选或配置哈希不一致、结果不完整、签名无效都必须保持 `BLOCKED`。私钥、供应商令牌和生产配置不得写入仓库或证据文件。

校验命令：

```text
node scripts/validate-waf-evidence.mjs <evidence.json> --candidate <commit> --config-hash <sha256> --public-key <owner-public-key.pem>
```
