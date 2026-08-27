# QuantXY backend open-source reuse audit

Date: 2026-08-27

## Scope and non-negotiable boundaries

This was a read-only audit of the official repositories for [Open ACE](https://github.com/open-ace/open-ace), [NocoBase](https://github.com/nocobase/nocobase), [Coze Studio](https://github.com/coze-dev/coze-studio), and the official [Lark/Feishu Node SDK](https://github.com/larksuite/node-sdk). No repository was cloned, no package was installed, and no runtime or database was changed.

QuantXY keeps its existing Supabase PostgreSQL schema, RLS/RBAC, session-derived tenant scope, transactional RPC commands, append-only audit, durable outbox, and business routes as the system of record. Reuse must enter through narrow TypeScript ports; external code must not own QuantXY identity, permissions, business transactions, or persistence.

License notes below are engineering gates, not legal advice. Any source-level copying still requires a file-level license and notice review.

## Decision summary

| Repository | Reuse decision | Directly useful surface | Explicit exclusion |
| --- | --- | --- | --- |
| Lark/Feishu Node SDK | Approved for selective dependency integration in Plan 03 Task 5 after parity tests | Typed `Client`, token handling, message/card APIs, `EventDispatcher`, `CardActionHandler` | No direct SDK calls from business RPCs; no replacement of outbox, replay protection, tenant checks, or audit |
| Open ACE | Approved as an architecture reference only | Provider/CLI adapters, server-side key custody, scoped short-lived proxy tokens, usage/cost/quota/audit model, pause/resume human controls | No Flask/SQLAlchemy backend, Alembic schema, RBAC, or remote-agent runtime import |
| Coze Studio | Approved as an architecture reference; optional future provider-side integration only | Provider abstraction, versioned workflow publication, run trace, typed node contracts, conversation/knowledge/plugin boundaries | No Coze sidecar or database in the current release; no code-node execution; no replacement of QuantXY Agent/runtime or permissions |
| NocoBase | No code or runtime integration | Concepts only: field-level permissions, AI actors using the same authorization boundary, workflow audit, plugin registry separation | No source copying, embedding, branded runtime, schema, ACL engine, or plugin packages without separate commercial/legal approval |

## Repository findings

### 1. Lark/Feishu Node SDK: selective integration approved

The official TypeScript SDK is MIT-licensed and already encapsulates tenant token acquisition, typed OpenAPI calls, message cards, event decryption/dispatch, card callbacks, and framework adapters. These are a close fit for QuantXY's existing server-only Feishu modules.

Adopt during Plan 03 Task 5 behind a `FeishuTransport` port:

- use `Client` for outbound task messages and template cards;
- normalize SDK errors into the existing safe outbox error codes;
- keep QuantXY request IDs, notification IDs, attempt tokens, recipient dedupe keys, retry schedule, and terminal delivery state in PostgreSQL;
- evaluate `EventDispatcher` and `CardActionHandler` only through parity tests against the existing webhook verifier;
- pin an exact package version and run license, dependency, unit, webhook fixture, and lost-response retry gates before switching the transport.

Do not adopt `WSClient` as the production event path in the current web deployment. The official README states that long-connection delivery is cluster-distributed rather than broadcast and handlers must finish within three seconds. A future long-connection mode would require a separately deployed singleton/fenced worker, not a Next.js request process.

The current custom verifier in `src/features/feishu/webhook-event.ts` enforces a five-minute replay window, constant-time token/app/tenant checks, a strict event allowlist, and payload digests. The SDK may replace cryptographic and OpenAPI plumbing only if all of those QuantXY controls remain covered. The current durable worker and database fences remain authoritative.

### 2. Open ACE: borrow governance patterns, not the backend

Open ACE is Apache-2.0 and exposes the most relevant governance ideas: server-side API-key custody, short-lived revocable proxy tokens, provider/CLI adapters, usage and cost tracking, quotas, anomaly detection, audit exports, and human pause/resume/fork controls. Its own structure separates routes, services, domain modules, repositories, remote agents, migrations, and tests.

Reuse these patterns in native QuantXY code:

- Plan 07: replace the process-local limiter with tenant/user/operation quota rows; add provider-independent invocation and cost projections;
- Plan 08: keep Agent versions and tool scopes server-owned; add budget checks, kill switch, recovery, and human control transitions;
- Plan 09: derive usage, cost, quota, anomaly, and compliance dashboards from append-only QuantXY invocation/audit data;
- future provider work: introduce an `AiProviderAdapter` contract before adding any provider beyond the current DeepSeek implementation.

Do not import the Python/Flask/SQLAlchemy/Alembic implementation. Its database and authorization model would duplicate and weaken the already completed Supabase RLS/RPC design. Remote shell, browser terminal, and code-server proxy functions are outside the current commercial workstation scope.

### 3. Coze Studio: borrow runtime contracts, do not embed now

Coze Studio is Apache-2.0 and uses a Go microservice/DDD backend with React/TypeScript frontend. Its useful surfaces are model-provider management, versioned workflow creation/publication, conversation APIs, run traces, and clear boundaries between workflows, knowledge, plugins, databases, prompts, and applications.

Apply only the following patterns to Plans 07 and 08:

- version workflow definitions and pin the published version used by every invocation;
- validate node input/output schemas before execution and persist a trace per node;
- keep provider, knowledge, plugin/tool, conversation, and workflow ports separate;
- publish only after validation, authorization, and audit, with immutable references from executions to the published version.

Do not deploy Coze Studio beside QuantXY or connect it to the QuantXY database in this release. The official repository warns about public-deployment risks including code-node execution, SSRF, listening-address exposure, and horizontal authorization issues. Its runtime would add a second identity, permission, workflow, and persistence plane. After QuantXY Plan 07 creates a provider-neutral port, a separate optional spike may assess Coze's published API as an external provider using allowlisted egress and server-held credentials.

### 4. NocoBase: concepts only because of product and license conflict

NocoBase demonstrates useful product concepts: field-level permissions, AI actors constrained by the same permissions as human users, audited workflow triggers, and modular data/workflow/plugin boundaries. QuantXY already implements the stronger database-owned equivalent through RLS, scoped RPCs, and immutable audit, so replacing it would not add value.

The repository's current license adds terms beyond Apache-2.0. It restricts branding changes and public no-code/low-code/AI SaaS or PaaS use, and places additional conditions on selling upper-layer applications. QuantXY is intended for commercial delivery, so no NocoBase source, runtime, plugins, ACL engine, or database model may enter this codebase without a separately documented commercial-license and legal decision.

## Approved implementation order

1. Continue Plan 03 Task 2 on the existing database and authorization foundation.
2. In Plan 03 Task 5, add RED parity tests, then integrate the official Lark Node SDK only inside a `FeishuTransport` adapter. Keep the durable outbox and webhook security controls unchanged.
3. In Plans 07 and 08, implement native TypeScript/Supabase provider, quota, workflow-version, trace, budget, recovery, and kill-switch contracts using the Open ACE and Coze patterns as references.
4. Keep NocoBase and Coze runtime embedding rejected for the current release. Reconsider only through a separate architecture, security, license, migration, rollback, and load-test gate.

## Integration acceptance gates

- no new service or package can read or write QuantXY business tables outside current RLS/RPC contracts;
- browser input never supplies tenant, actor, provider secret, system prompt, Agent tool scope, or authorization;
- all external calls have bounded timeouts, safe error mapping, idempotency/reconciliation, durable audit, and testable retry behavior;
- every dependency is pinned, license-recorded, vulnerability-scanned, and covered by unit plus integration tests;
- an integration is rejected if it requires a second source of truth for identity, RBAC, projects, tasks, Agents, workflows, or audit.
