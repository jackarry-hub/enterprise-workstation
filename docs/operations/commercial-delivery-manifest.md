# QuantXY 商用交付制品清单

冻结日期：2026-08-30  
作者：Codex / QuantXY Commercial Completion  
应用候选提交：`956a349eacf697f9445107857007f517afb58567`  
迁移集合 SHA-256：`e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361`

本清单冻结候选提交中已提交的交付制品。清单自身由后续 envelope commit 追踪，避免自引用哈希；Task 8 不得修改本清单。外部 Staging/Canary 证据采用 `external-release-manifest.schema.json` 的 append-only JSON，并重新绑定最终候选 commit/tree。

| Artifact | Candidate commit | Migration SHA-256 | Artifact SHA-256 | Validation command |
| --- | --- | --- | --- | --- |
| `docs/operations/external-release-manifest.schema.json` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `3c2a95150827f39e0dfe387747941d5b69e1ef25f7264a30f9a57d6167e3ce52` | `npm run validate:delivery-artifacts` |
| `docs/operations/architecture.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `ea9fbb85d51e3015bae5d8c094570b4a2b347394fc7c08fc8bc437dcb7c95775` | `npm run validate:delivery-artifacts` |
| `docs/operations/database-er.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `14b1551461bca16d07fe807a17c506ffbce3d6796e35953d30123417147458cd` | `npm run validate:delivery-artifacts` |
| `docs/operations/data-dictionary.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `e3158c3aa776bd7ab5f95d716b74a2a0bc660a5dfb18b55390477de7c6aea291` | `npm run validate:delivery-artifacts` |
| `docs/operations/permission-matrix.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `425e99967434557ec7dbdcca4acd4f8b32cdee1931b52f0aa5face17c88a0547` | `npm run validate:delivery-artifacts` |
| `docs/operations/feishu-sync-rules.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `dafd90bfcc084a85904e28f9c8ec12e4cdc6ad63e9c7656aee9b5c0df6eedbaa` | `npm run validate:delivery-artifacts` |
| `docs/operations/openapi.yaml` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `dc8171945c1753a2b536c980bbd0f59ecba00223bdf120cbcd238f080e791569` | `npm run validate:delivery-artifacts` |
| `docs/operations/admin-manual.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `85c508c6d619019d0312a30de427842d785d92754bcf7311b9782caa6a2fa928` | `npm run validate:delivery-artifacts` |
| `docs/operations/employee-manual.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `b5898145e7ba4ecdbac4594887db71fd014763b145b0e7188a973fe196298f77` | `npm run validate:delivery-artifacts` |
| `docs/operations/import-templates/customers.csv` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `2d34632e4d683a99a0a9cd6685c2b585c82985f7bc26c37161b71a093744c1ad` | `npm run validate:delivery-artifacts` |
| `docs/operations/import-templates/employees.xlsx` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `c91a24650872ef1460cbb78400c7dfa2f9c72037374d8c2315a2e2a36b91a496` | `npm run validate:delivery-artifacts` |
| `docs/operations/deployment-manual.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `9f63816777a08de71f227983dc2f83af1507e399e6c9886268ccab2b6b70a872` | `npm run validate:delivery-artifacts` |
| `docs/operations/backup-restore-manual.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `7420d218e2e80414d38107ddf335e7d4307e4bc3ee543e508c470873276d80f2` | `npm run validate:delivery-artifacts` |
| `docs/operations/incident-response.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `cb456828efb34b1c7ea6998ba67b3a149bf4e56db6fcb4b820c84bcbf4503035` | `npm run validate:delivery-artifacts` |
| `docs/operations/release-runbook.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `16e19d5b5560024507c9eeb1f19af4452536b3e75983e2d92649825bd9feb1c6` | `npm run validate:delivery-artifacts` |
| `docs/operations/rollback-runbook.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `d62492951831d4087884be9fb28e39d49a3b72fac400066cbca123060c659727` | `npm run validate:delivery-artifacts` |
| `docs/operations/security-test-report.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `fe5f60b2591312a74098591a967fa7bb50769e7ef086ce400ab7d4b2d5015e44` | `npm run validate:delivery-artifacts` |
| `docs/operations/performance-test-report.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `574884b39a161d50561c66fbb314d9d6d83c145e5bfd575e2bb887113ff9c28e` | `npm run validate:delivery-artifacts` |
| `docs/operations/third-party-services.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `0edc2a2ec22ef13357db69e287d7381b4ce2a5731a64d9f4327ab7c15da784d2` | `npm run validate:delivery-artifacts` |
| `docs/operations/secret-locations.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `3e53d940890048fc085d008560624e58a3e7fe7a553ca49724f7110d898cd796` | `npm run validate:delivery-artifacts` |
| `docs/operations/third-party-fees.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `d36371363be057b5f315912a5411439a861f6b5794daa82ab0bbd4d5ce7b308e` | `npm run validate:delivery-artifacts` |
| `docs/operations/known-limitations.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `4f0804c8f3f161bdb96ee424e763d7326502486b3009d716f41f6c95a6cc8a6b` | `npm run validate:delivery-artifacts` |
| `docs/operations/commercial-acceptance-checklist.md` | `956a349eacf697f9445107857007f517afb58567` | `e48ab223ba464883acc7d5fed8b062f8bcd45d5e409f7014de604390d4b3b361` | `098a46639f8a4be57b3636153d8be00a2fe31781d38185a1e5260ab22b0d27ef` | `npm run validate:delivery-artifacts` |

## Validation boundary

`npm run validate:delivery-artifacts` 校验文件存在、OpenAPI 核心路径、CSV/XLSX 结构、必需章节、候选一致性、迁移摘要和逐文件 SHA-256。员工 XLSX 已回读并完成结构/字段/公式错误扫描；当前本机 artifact renderer 无错误输出即退出，未取得 PNG 视觉证据，该项不得表述为视觉已验证。真实数据库、容器、浏览器、外部服务、负载、恢复、Canary 和真机证据只允许进入外部签名清单。

