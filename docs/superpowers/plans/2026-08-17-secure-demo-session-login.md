# Secure Demo Session Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing QuantXY demo login directly for the fused workstation while protecting AI configuration with a signed server session.

**Architecture:** The standalone HTML owns only the login presentation. Next.js route handlers validate deployment credentials and issue a signed HttpOnly cookie; AI routes accept that cookie as a tenant-scoped executive session while retaining the existing Supabase session fallback. Middleware bypasses Feishu only for the standalone HTML and self-authorizing APIs.

**Tech Stack:** Next.js 15 Route Handlers, TypeScript, Web Crypto HMAC-SHA256, Supabase, standalone ES5-compatible HTML/JavaScript, Vitest, Node test runner.

## Global Constraints

- Do not expose `WORKSTATION_DEMO_PASSWORD`, `AI_CONFIG_ENCRYPTION_KEY`, the signed cookie payload, or a complete third-party API Key.
- Keep all existing Feishu authentication behavior outside the fused workstation unchanged.
- Keep `/api/ai/config` and `/api/ai/chat` server-authorized and tenant-scoped.
- Preserve the current demo login visual design and post-login identity switcher.
- Preserve the supplied source HTML byte-for-byte and keep root/public fused HTML identical.
- Every production change follows RED, GREEN, refactor, and focused verification.

---

### Task 1: Signed demo session boundary

**Files:**
- Create: `src/features/demo-auth/demo-auth-env.ts`
- Create: `src/features/demo-auth/demo-auth-env.test.ts`
- Create: `src/features/demo-auth/demo-session.ts`
- Create: `src/features/demo-auth/demo-session.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `getDemoAuthEnv(): DemoAuthEnv`
- Produces: `createDemoSessionToken(env, remember, now?): Promise<string>`
- Produces: `verifyDemoSessionToken(token, env, now?): Promise<DemoSessionClaims | null>`
- Produces: `createDemoWorkspaceSession(claims): WorkspaceSession`

- [ ] Write failing tests for missing configuration, credential comparison, token expiry, bad signatures, and the executive/admin workspace session.
- [ ] Run `npx vitest run --maxWorkers=1 src/features/demo-auth` and verify failures are caused by missing modules.
- [ ] Implement environment validation, domain-separated HMAC signing, verification, and session mapping.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Demo auth routes and AI session bridge

**Files:**
- Create: `src/features/demo-auth/demo-auth-handler.ts`
- Create: `src/features/demo-auth/demo-auth-handler.test.ts`
- Create: `src/app/api/demo-auth/login/route.ts`
- Create: `src/app/api/demo-auth/session/route.ts`
- Create: `src/app/api/demo-auth/logout/route.ts`
- Modify: `src/features/ai-config/workspace-api-session.ts`
- Modify: `src/features/ai-config/workspace-api-session.test.ts`
- Modify: `src/app/api/ai/config/route.ts`
- Modify: `src/app/api/ai/chat/route.ts`

**Interfaces:**
- Produces: `handleDemoLogin(request, env): Promise<Response>`
- Produces: `handleDemoSession(request, env): Promise<Response>`
- Produces: `handleDemoLogout(): Response`
- Changes: `getWorkspaceApiSession(request?: Request, client?: SupabaseClient)`

- [ ] Write failing route-handler tests for invalid credentials, signed cookie attributes, session restoration, logout, and AI session short-circuiting.
- [ ] Run the focused Vitest files and verify RED.
- [ ] Implement the pure handlers and thin Route Handler adapters.
- [ ] Parse the demo Cookie before the Supabase fallback in `getWorkspaceApiSession` and pass each route request through.
- [ ] Re-run focused tests and verify GREEN.

### Task 3: Direct standalone entry and server-backed HTML login

**Files:**
- Modify: `src/middleware.ts`
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html`
- Update: `public/quantxy-ai-workbench-fused.html`

**Interfaces:**
- Consumes: `GET /api/demo-auth/session`, `POST /api/demo-auth/login`, `POST /api/demo-auth/logout`.
- Preserves: `file://` local-only demo gate and the existing `S.me` identity switching behavior.

- [ ] Add failing HTML and middleware contracts proving the fused HTML no longer redirects to Feishu and HTTP login uses the demo-auth APIs.
- [ ] Run the focused tests and verify RED.
- [ ] Add the narrow middleware bypass for the fused HTML, demo-auth endpoints, and self-authorizing AI endpoints.
- [ ] Convert HTTP `submitLogin`, startup restoration, and logout to the server routes; clear password input after every response.
- [ ] Mechanically copy root HTML to `public` and run the contract tests to verify GREEN.

### Task 4: Deployment and browser verification

**Files:**
- Verify all modified files.

- [ ] Run focused demo-auth and AI tests, the complete HTML contracts, typecheck, lint, and production build.
- [ ] Confirm root/public HTML hashes match and scan deployed assets for API Key or demo password literals outside the explicit file-only fallback.
- [ ] Start the local server with required environment variables.
- [ ] Browser flow: fused HTML -> demo login visible -> wrong password remains on login -> correct server login enters workstation -> refresh remains authenticated -> logout returns to demo login.
- [ ] Verify page identity, meaningful DOM, no framework overlay, clean console, visible enabled login button, and screenshot evidence.
- [ ] Commit only the scoped files.
