# Third-party notices

## Lark/Feishu OpenAPI Node SDK

- Package: `@larksuiteoapi/node-sdk`
- Version: `1.73.0` (exactly pinned)
- Upstream: <https://github.com/larksuite/node-sdk>
- License: MIT
- Use in QuantXY: server-only Feishu OpenAPI client, tenant token lifecycle, and interactive message delivery.

QuantXY keeps notification claims, retry leases, provider idempotency UUIDs, tenant scope, delivery state, and audit evidence in its own PostgreSQL outbox. The SDK does not own QuantXY identity, permissions, or business persistence.
