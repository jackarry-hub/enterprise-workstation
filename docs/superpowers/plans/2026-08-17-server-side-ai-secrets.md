# Server-Side AI Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every model API secret from the browser and add a write-only, encrypted, tenant-scoped Next.js backend configuration flow for DeepSeek.

**Architecture:** The standalone HTML calls same-origin Next.js APIs only. Route handlers authenticate through the existing Supabase workspace session, encrypt new keys with AES-256-GCM, store ciphertext in an RLS-protected Supabase table, and return only sanitized metadata. Model requests are proxied server-side with validation, timeout, and basic rate limiting.

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, Node Web Crypto, Supabase, PostgreSQL RLS, Vitest, Node test runner, standalone HTML/CSS/JavaScript, Browser plugin QA.

## Global Constraints

- Never return, log, serialize, cache, or render a complete third-party API key.
- `AI_CONFIG_ENCRYPTION_KEY` must be a 32-byte Base64 server-only environment variable and must not use a `NEXT_PUBLIC_` prefix.
- `SUPABASE_SERVICE_ROLE_KEY` remains server-only.
- The API Base URL is fixed to `https://api.deepseek.com`; browser input cannot select arbitrary upstream hosts.
- Supported models are exactly `deepseek-v4-flash`, `deepseek-chat`, and `deepseek-reasoner`.
- Configuration updates require `primaryRole === "executive"` or `isAdmin === true`.
- Model calls require an authenticated workspace member and are tenant-scoped.
- Preserve the supplied source HTML byte-for-byte and retain the existing exclusion of attendance, leave, and payroll in the fused HTML.
- Every production change follows RED → GREEN → refactor and ends with a focused commit.

---

## File Map

- Create: `src/features/ai-config/ai-config-env.ts` — validate server-only AI configuration environment variables.
- Create: `src/features/ai-config/ai-secret-crypto.ts` — AES-256-GCM encryption and decryption.
- Create: `src/features/ai-config/ai-config-types.ts` — provider constants, model allowlist, public/private configuration types.
- Create: `src/features/ai-config/ai-config-store.ts` — tenant-scoped Supabase service-role persistence.
- Create: `src/features/ai-config/workspace-api-session.ts` — resolve and validate the current workspace session for APIs.
- Create: `src/features/ai-config/ai-config-handler.ts` — pure GET/PUT configuration behavior with injected dependencies.
- Create: `src/features/ai-config/ai-chat-handler.ts` — validated server-side DeepSeek proxy behavior with injected fetch.
- Create: `src/app/api/ai/config/route.ts` — Next.js adapter for configuration GET/PUT.
- Create: `src/app/api/ai/chat/route.ts` — Next.js adapter for model POST.
- Create: matching `*.test.ts` files beside each focused feature module.
- Create: `supabase/migrations/202608170001_ai_provider_configs.sql` — tenant-scoped encrypted secret table and RLS.
- Modify: `src/features/operations/role-access.ts` and test — allow authenticated middleware traversal to workstation and AI API paths; handlers retain fine-grained authorization.
- Modify: `.env.example` — document the encryption key.
- Modify: `quantxy-ai-workbench-fused.html` — remove browser secrets and render the write-only configuration UI.
- Modify: `tests/html-fusion-contract.test.mjs` — prevent secret regressions and verify the new UI/API contract.
- Create/update: `public/quantxy-ai-workbench-fused.html` — deployable copy identical to the root deliverable.

---

### Task 1: Server Environment and AES-GCM Secret Boundary

**Files:**
- Create: `src/features/ai-config/ai-config-env.ts`
- Create: `src/features/ai-config/ai-config-env.test.ts`
- Create: `src/features/ai-config/ai-secret-crypto.ts`
- Create: `src/features/ai-config/ai-secret-crypto.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getAiConfigEnv(): { encryptionKey: Uint8Array; supabaseServiceRoleKey: string }`
- Produces: `encryptApiKey(value: string, key: Uint8Array): Promise<{ ciphertext: string; iv: string; hint: string }>`
- Produces: `decryptApiKey(payload: { ciphertext: string; iv: string }, key: Uint8Array): Promise<string>`

- [ ] **Step 1: Write failing environment and crypto tests**

Tests must prove: missing/invalid Base64 key is rejected without echoing the value; a 32-byte key is accepted; encryption round-trips; two encryptions use different IVs; wrong-key decryption rejects; only the final four characters are returned as `hint`.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/ai-config/ai-config-env.test.ts src/features/ai-config/ai-secret-crypto.test.ts`

Expected: FAIL because both production modules are missing.

- [ ] **Step 3: Implement the minimum server-only boundary**

Use `webcrypto.subtle.importKey` with `{ name: "AES-GCM" }`, a new `crypto.getRandomValues(new Uint8Array(12))` IV for every update, and Base64 encoding via `Buffer`. Error messages may name environment variable keys but must never include their values.

- [ ] **Step 4: Run GREEN and commit**

Run the focused tests, then:

```powershell
git add .env.example src/features/ai-config/ai-config-env.ts src/features/ai-config/ai-config-env.test.ts src/features/ai-config/ai-secret-crypto.ts src/features/ai-config/ai-secret-crypto.test.ts
git commit -m "feat: add encrypted ai secret boundary"
```

---

### Task 2: Tenant-Scoped Encrypted Configuration Store

**Files:**
- Create: `src/features/ai-config/ai-config-types.ts`
- Create: `src/features/ai-config/ai-config-store.ts`
- Create: `src/features/ai-config/ai-config-store.test.ts`
- Create: `supabase/migrations/202608170001_ai_provider_configs.sql`
- Modify: `tests/unit/phase1-pgtap-contract.test.ts`

**Interfaces:**
- Produces: `AI_MODELS` and `isAllowedAiModel(value: unknown): value is AiModel`
- Produces: `AiConfigRecord`, `PublicAiConfig`, and `sanitizeAiConfig(record, canManage)`.
- Produces: `createAiConfigStore(client)` with `get(tenantId)` and `upsert(input)`.

- [ ] **Step 1: Write failing type/store and migration contract tests**

Assert the model allowlist exactly, sanitized output excludes `encrypted_api_key` and `api_key_iv`, every store query includes `tenant_id`, and the migration contains the composite primary key, RLS enablement, and no authenticated read policy.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/ai-config/ai-config-store.test.ts tests/unit/phase1-pgtap-contract.test.ts`

Expected: FAIL for missing store and migration.

- [ ] **Step 3: Implement types, store, and SQL**

Use the existing `@supabase/supabase-js` dependency with the server URL and `SUPABASE_SERVICE_ROLE_KEY`. Store calls must use `.eq("tenant_id", tenantId).eq("provider", "deepseek")`. The public sanitizer returns only:

```ts
type PublicAiConfig = {
  provider: "deepseek";
  apiBaseUrl: "https://api.deepseek.com";
  model: AiModel;
  keyConfigured: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  canManage: boolean;
};
```

- [ ] **Step 4: Run GREEN and commit**

Run focused tests, then commit as `feat: add tenant scoped ai configuration store`.

---

### Task 3: Authenticated Write-Only Configuration API

**Files:**
- Create: `src/features/ai-config/workspace-api-session.ts`
- Create: `src/features/ai-config/workspace-api-session.test.ts`
- Create: `src/features/ai-config/ai-config-handler.ts`
- Create: `src/features/ai-config/ai-config-handler.test.ts`
- Create: `src/app/api/ai/config/route.ts`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/features/operations/role-access.test.ts`

**Interfaces:**
- Produces: `getWorkspaceApiSession(): Promise<WorkspaceSession | null>`.
- Produces: `handleGetAiConfig(deps): Promise<Response>`.
- Produces: `handlePutAiConfig(request, deps): Promise<Response>`.

- [ ] **Step 1: Write failing authorization and response tests**

Cover `401` without session, sanitized `GET`, `403` for non-manager `PUT`, `400` for invalid models/keys, model-only update preserving ciphertext, key update invoking encryption, and successful responses that contain none of `apiKey`, `ciphertext`, `iv`, or submitted key text. Add route-access expectations for `/api/ai` and `/quantxy-ai-workbench-fused.html`.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/ai-config/workspace-api-session.test.ts src/features/ai-config/ai-config-handler.test.ts src/features/operations/role-access.test.ts`

- [ ] **Step 3: Implement session and handlers**

Resolve the Supabase user and `current_workspace_access`, parse with `parseWorkspaceAccess`, and always return `Cache-Control: no-store`. `PUT` accepts `{ model, apiKey? }`; validate `apiKey` as trimmed `sk-` text between 12 and 300 characters. Never include submitted values in errors.

- [ ] **Step 4: Add the thin Next.js adapter**

The route builds the admin client/store, reads the environment key, and delegates to the pure handlers. Export `dynamic = "force-dynamic"`.

- [ ] **Step 5: Run GREEN and commit**

Run focused tests plus `npm run typecheck`, then commit as `feat: add write only ai configuration api`.

---

### Task 4: Authenticated Server-Side DeepSeek Proxy

**Files:**
- Create: `src/features/ai-config/ai-chat-handler.ts`
- Create: `src/features/ai-config/ai-chat-handler.test.ts`
- Create: `src/app/api/ai/chat/route.ts`

**Interfaces:**
- Produces: `handleAiChat(request, deps): Promise<Response>`.
- Consumes: workspace session, configuration store, `decryptApiKey`, and injectable `fetch`.

- [ ] **Step 1: Write failing proxy security tests**

Cover `401`, missing configuration, oversized body, too many messages, unsupported model, upstream timeout, upstream authentication error, and successful forwarding. Assert the browser request does not supply a third-party key, the server adds exactly one upstream `Authorization` header, and public errors never contain the decrypted key or upstream response body.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/features/ai-config/ai-chat-handler.test.ts`

- [ ] **Step 3: Implement validation, rate limit, decrypt, and fetch**

Limit raw body to 64 KiB, messages to 30, each text field to 12,000 characters, and one process to 30 requests per minute per tenant/user key. Call only `https://api.deepseek.com/chat/completions` with an `AbortSignal.timeout(45_000)` signal.

- [ ] **Step 4: Add the Next.js adapter, run GREEN, and commit**

Run focused tests and typecheck, then commit as `feat: proxy ai calls with server side secrets`.

---

### Task 5: Remove Browser Secrets and Build the Write-Only Settings Card

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html`

**Interfaces:**
- Consumes: `GET/PUT /api/ai/config`, `POST /api/ai/chat`.
- Produces browser state: `S.aiConfig = { loading, error, provider, apiBaseUrl, model, keyConfigured, keyHint, updatedAt, canManage }`.

- [ ] **Step 1: Add failing HTML security contracts**

Assert the fused HTML contains no `sk-` key literal, does not serialize `apiKey`, never sets `Authorization` or `x-api-key`, calls `/api/ai/chat` and `/api/ai/config`, includes `data-act="update-ai-key"` and `data-act="save-ai-model"`, and renders the Chinese labels “输入新 Key 进行更新”, “更新密钥”, and “更新时间”.

- [ ] **Step 2: Run RED**

Run: `node --test --test-name-pattern "server-side ai secret" tests/html-fusion-contract.test.mjs`

Expected: FAIL because the old embedded key and direct-auth headers still exist.

- [ ] **Step 3: Remove secret-bearing browser state**

Delete `apiKey`, `proxy`, and `keyCleared` from the initial `S.cfg`. Before reusing persisted `saved.cfg`, remove `apiKey`, `proxy`, and `keyCleared`, then call `save()` once to overwrite legacy local storage without secrets.

- [ ] **Step 4: Replace direct calls and settings UI**

`aiCall()` posts JSON to `/api/ai/chat` with `credentials:'same-origin'`. The settings card shows only sanitized metadata, a read-only Base URL, model select, blank password input for a new key, and separate model/key buttons. On successful key update, clear the input and fetch sanitized config again.

- [ ] **Step 5: Run GREEN and commit**

Run focused and full HTML contracts, parse the main script with Acorn, then commit as `feat: make model keys write only in workstation html`.

---

### Task 6: Deployable HTML Copy and End-to-End Verification

**Files:**
- Create/update: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-fusion-contract.test.mjs`
- Verify: all earlier files

**Interfaces:**
- Produces: `/quantxy-ai-workbench-fused.html` from the Next.js public directory.

- [ ] **Step 1: Add a failing deployment-copy contract**

Read both root and public files and assert exact text equality. Assert the original supplied source hash remains `7E2437FDC2D6E9688076D582AA683F12E9FAFB40994E2936DAB34A0A4CD44607`.

- [ ] **Step 2: Run RED, copy the verified root artifact, and run GREEN**

Use a mechanical copy after the root HTML is final. Run the full HTML test suite.

- [ ] **Step 3: Run project verification**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
node --test tests/html-fusion-contract.test.mjs
```

- [ ] **Step 4: Run browser QA**

The flow under test is: authenticated workstation → 系统设置 → inspect sanitized AI configuration → enter a new key → update → input clears and only hint/time remain → change model without re-entering key → AI test calls same-origin proxy.

Check desktop and 390×844, page identity, nonblank DOM, no framework overlay, no relevant warnings/errors, settings-card screenshot, request behavior, and preserved login/customer/activity/decision flows. Do not use a real production key during automated QA; use an isolated test backend or dependency-injected route tests.

- [ ] **Step 5: Scan for secret regressions and commit**

Run `rg -n "sk-[A-Za-z0-9_-]{8,}|apiKey|Authorization.*Bearer" quantxy-ai-workbench-fused.html public src` and inspect every match. Expected: no hardcoded third-party key, no browser key persistence, and `Authorization` only in the server-side upstream proxy. Commit deployable-copy changes as `test: verify secure ai deployment path`.

---

## Plan Self-Review Checklist

- [ ] Every requirement in `docs/superpowers/specs/2026-08-17-server-side-ai-secrets-design.md` maps to a task.
- [ ] No step contains implementation placeholders or undefined neighboring interfaces.
- [ ] `PublicAiConfig`, route payload names, storage fields, and HTML state names remain consistent across tasks.
- [ ] Tenant scoping, executive/admin update authorization, no-store responses, and RLS are tested.
- [ ] The browser never receives an old secret and never writes a new secret to local storage.
- [ ] The currently embedded key is removed from both root and deployed HTML; revocation remains an external action for the user.
