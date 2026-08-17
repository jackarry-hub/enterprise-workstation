# Docker and Private GitHub Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the current fused workstation branch for reproducible Docker production builds, verify that secrets stay out of Git and the image context, then publish the verified commit to the user-designated private GitHub repository.

**Architecture:** Build the Next.js application with `output: "standalone"` and a multi-stage Node image. Keep public build-time configuration explicit, inject server secrets only at container runtime, and exclude all local environment files from both Git and Docker build context.

**Tech Stack:** Next.js 15, TypeScript, npm, Docker multi-stage builds, Docker Compose, Git, GitHub.

## Global Constraints

- Do not modify any page UI.
- Do not commit `.env` or any `.env*.local` file.
- Keep `.env.example` as placeholder-only documentation.
- Do not skip TypeScript errors.
- Do not connect to or deploy on any application server.
- The only allowed remote publication target is the user-designated private GitHub repository.

---

### Task 1: Secret and Git boundary

**Files:**
- Modify: `.env.example`
- Verify: `.gitignore`

**Interfaces:**
- Consumes: runtime environment variable names already read under `src/features`.
- Produces: a placeholder-only environment contract while `.env*` remains ignored except `.env.example`.

- [x] **Step 1: Verify tracked environment files**

  Run `git ls-files | Select-String -Pattern '(^|/)\.env'` and confirm only `.env.example` is tracked.

- [x] **Step 2: Verify ignore coverage**

  Run `git check-ignore -v .env .env.local .env.development.local .env.production.local .env.test.local` and confirm every local environment variant matches `.env*`.

- [x] **Step 3: Repair the example contract**

  Keep placeholder values only and place `AI_CONFIG_ENCRYPTION_KEY=base64_encoded_32_byte_random_key` on its own active line.

- [x] **Step 4: Scan tracked content without printing secret values**

  Check for private key markers, provider key prefixes, GitHub tokens, JWTs, and database URLs; review every finding as either a placeholder/test fixture or a real leak.

### Task 2: Standalone production container

**Files:**
- Modify: `next.config.ts`
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm ci`, `npm run build`, Next.js standalone output, and runtime environment variables from `.env.example`.
- Produces: a non-root production container listening on port 3000 and a Compose service that accepts configuration from `docker compose --env-file`.

- [x] **Step 1: Enable standalone output**

  Add `output: "standalone"` to `next.config.ts` without changing application behavior.

- [x] **Step 2: Protect the image build context**

  Add `.dockerignore` entries for Git metadata, dependencies, build outputs, logs, local tooling, archives, and every `.env*` file.

- [x] **Step 3: Add the multi-stage image**

  Use Node 22 Alpine stages for dependencies and build; copy `.next/standalone`, `.next/static`, and `public` into a non-root runtime stage; start with `node server.js`.

- [x] **Step 4: Add Compose production wiring**

  Map `${APP_PORT:-3000}` to port 3000, pass public values as build arguments, pass server-only values at runtime, and add a local HTTP health check.

- [x] **Step 5: Document the exact production command**

  Document `docker compose --env-file .env.production.local up -d --build` and state that the local environment file is ignored by Git and Docker context.

### Task 3: Local verification and release

**Files:**
- Verify: all deployment files above

**Interfaces:**
- Consumes: clean npm dependencies and the configured Git remote.
- Produces: a verified commit and a pushed branch in the private GitHub repository.

- [x] **Step 1: Install deterministic dependencies**

  Run `npm ci` and require exit code 0.

- [x] **Step 2: Verify TypeScript, lint, tests, and production build**

  Run `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=1`, and `npm run build`; fix failures rather than bypassing them.

- [x] **Step 3: Validate generated standalone artifacts**

  Confirm `.next/standalone/server.js`, `.next/static`, and `public` exist after the build.

- [ ] **Step 4: Validate Docker configuration when tooling is available**

  Run `docker compose --env-file <local-placeholder-file> config` and `docker build`; if Docker is unavailable, record that image execution remains an explicit tooling blocker.

- [x] **Step 5: Commit only intended files**

  Review `git diff`, stage explicit deployment paths, verify no `.env` file is staged, and commit with `chore: prepare standalone Docker deployment`.

- [ ] **Step 6: Publish only to the private target**

  Verify the target repository visibility is private, push the current branch with upstream tracking, record the repository URL and commit hash, then stop without connecting to any deployment server.
