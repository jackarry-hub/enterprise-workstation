# QuantXY Knowledge Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver versioned, permission-aware knowledge upload, publication, search, preview, and source citation.

**Architecture:** PostgreSQL owns directories, versions, permissions, publication state, and searchable text; Supabase Storage owns document binaries. Search and AI citation always filter through current-user document access.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL/Storage, PostgreSQL full-text search, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-05 and verified file upload from Plan 03.
- Drafts are visible only to author and authorized knowledge managers.
- Published versions are immutable; later edits create new versions.
- Formal knowledge pages never use `knowledge-mock-data.ts`.

---

### Task 1: Create knowledge directories, versions, and access rules

**Files:**
- Create: `supabase/migrations/202608260020_knowledge_versions.sql`
- Create: `supabase/tests/knowledge_access.sql`
- Create: `src/features/knowledge/knowledge-types-v2.ts`

**Interfaces:**
- Produces tables `knowledge_directories`, `knowledge_document_versions`, `knowledge_permissions`, `knowledge_sources`.
- Extends `knowledge_documents` with directory, current version, archived state, and owner.

- [ ] **Step 1: Write failing draft/published/cross-tenant access tests**

```sql
select is((select count(*) from public.knowledge_document_versions where status = 'draft'), 1::bigint, 'author sees own draft');
select is((select count(*) from public.knowledge_document_versions where status = 'draft'), 0::bigint, 'unrelated member cannot see draft');
```

- [ ] **Step 2: Verify RED**

Run: `npm run db:test`
Expected: version and permission tables do not exist.

- [ ] **Step 3: Implement schema, RLS, FORCE RLS, and immutable published versions**

Add composite tenant/org foreign keys, directory/member/department/role grants, version sequence uniqueness, and a trigger rejecting updates to published version content.

- [ ] **Step 4: Verify GREEN**

Run: `npm run db:reset:test`
Run: `npm run db:test`
Expected: author/manager/published-reader cases pass; unrelated and cross-tenant reads return zero.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260020_knowledge_versions.sql supabase/tests/knowledge_access.sql src/features/knowledge/knowledge-types-v2.ts
git commit -m "feat: add versioned knowledge access model"
```

### Task 2: Add upload, publish, archive, and directory commands

**Files:**
- Create: `supabase/migrations/202608260021_knowledge_commands.sql`
- Modify: `supabase/tests/knowledge_access.sql`
- Create: `src/features/knowledge/knowledge-command-handler.ts`
- Create: `src/features/knowledge/knowledge-command-handler.test.ts`
- Create: `src/app/api/workstation/knowledge/directories/route.ts`
- Create: `src/app/api/workstation/knowledge/documents/route.ts`
- Create: `src/app/api/workstation/knowledge/documents/[documentId]/versions/route.ts`
- Create: `src/app/api/workstation/knowledge/documents/[documentId]/publish/route.ts`

**Interfaces:**
- Produces audited create directory, create draft, add version, publish, archive commands.
- Document create consumes a verified file public ID from Plan 03.

- [ ] **Step 1: Write failing file, permission, and immutable-version tests**

```ts
expect((await createDraft({ fileId: unverifiedFile })).status).toBe(422);
expect((await publishDraft(employeeWithoutManage)).status).toBe(403);
expect((await overwritePublishedVersion()).status).toBe(409);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/knowledge/knowledge-command-handler.test.ts`
Expected: handler is absent.

- [ ] **Step 3: Implement commands and publication transaction**

Publish locks the document, verifies draft ownership and permission, marks version published, updates current version, writes search text/source metadata and audit atomically.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/knowledge/knowledge-command-handler.test.ts`
Run: `npm run db:test`
Expected: verified upload publishes; unauthorized and overwrite operations fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260021_knowledge_commands.sql supabase/tests/knowledge_access.sql src/features/knowledge/knowledge-command-handler.ts src/features/knowledge/knowledge-command-handler.test.ts src/app/api/workstation/knowledge/directories/route.ts src/app/api/workstation/knowledge/documents/route.ts src/app/api/workstation/knowledge/documents/[documentId]/versions/route.ts src/app/api/workstation/knowledge/documents/[documentId]/publish/route.ts
git commit -m "feat: add knowledge publication commands"
```

### Task 3: Add permission-filtered search and source retrieval

**Files:**
- Create: `supabase/migrations/202608260022_knowledge_search.sql`
- Modify: `supabase/tests/knowledge_access.sql`
- Create: `src/features/knowledge/knowledge-search.ts`
- Create: `src/features/knowledge/knowledge-search.test.ts`
- Create: `src/app/api/workstation/knowledge/search/route.ts`
- Create: `src/app/api/workstation/knowledge/documents/[documentId]/source/route.ts`

**Interfaces:**
- Produces RPC `search_current_knowledge(query text, limit_count integer)` returning document/version/source identifiers and rank.
- Produces signed source download only after current-user permission check.

- [ ] **Step 1: Write failing authorization and source-identity tests**

```ts
expect(searchResults.every((row) => row.versionId && row.documentId)).toBe(true);
expect(unrelatedSearchResults).not.toContainEqual(expect.objectContaining({ documentId: privateDocId }));
expect((await sourceRequest(unrelatedSession)).status).toBe(404);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/knowledge/knowledge-search.test.ts`
Expected: search module is absent.

- [ ] **Step 3: Implement RLS-aware full-text search and signed source retrieval**

Search only published accessible versions, cap query length/results, return stable citations, and generate short-lived source URLs after permission verification.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/knowledge/knowledge-search.test.ts`
Run: `npm run db:test`
Expected: private documents never appear; citations always include document and version IDs.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260022_knowledge_search.sql supabase/tests/knowledge_access.sql src/features/knowledge/knowledge-search.ts src/features/knowledge/knowledge-search.test.ts src/app/api/workstation/knowledge/search/route.ts src/app/api/workstation/knowledge/documents/[documentId]/source/route.ts
git commit -m "feat: add permission-aware knowledge search"
```

### Task 4: Replace the mock knowledge workspace with real responsive UI

**Files:**
- Modify: `src/features/knowledge/knowledge-workspace.tsx`
- Modify: `src/features/knowledge/knowledge-page.tsx`
- Modify: `src/features/knowledge/knowledge-page.test.tsx`
- Modify: `src/features/knowledge/components/document-preview-dialog.tsx`
- Modify: `src/features/knowledge/components/document-panels.tsx`
- Create: `src/features/knowledge/knowledge-data.ts`
- Create: `src/features/knowledge/knowledge-data.test.ts`
- Create: `tests/e2e/knowledge.spec.ts`

**Interfaces:**
- Consumes Tasks 1-3 repositories and commands.
- Produces desktop directory/list/preview and mobile card/full-screen preview UI.

- [ ] **Step 1: Write failing mock-removal and citation tests**

```tsx
expect(screen.getByText(databaseDocument.title)).toBeInTheDocument();
expect(screen.queryByText(mockDocument.title)).not.toBeInTheDocument();
expect(screen.getByRole("link", { name: "查看来源" })).toHaveAttribute("data-version-id", versionId);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/knowledge/knowledge-page.test.tsx src/features/knowledge/knowledge-data.test.ts`
Expected: workspace imports mock data and source preview is not real.

- [ ] **Step 3: Connect server data and commands**

Remove mock imports, show explicit empty/denied/failed states, use verified upload and publish flows, and render source links from server identifiers.

- [ ] **Step 4: Verify GREEN and browser flow**

Run: `npx vitest run src/features/knowledge`
Run: `npx playwright test tests/e2e/knowledge.spec.ts --project=chrome`
Expected: upload -> draft -> publish -> search -> source survives refresh; private draft remains hidden.

- [ ] **Step 5: Commit**

```bash
git add src/features/knowledge tests/e2e/knowledge.spec.ts
git commit -m "feat: deliver the real knowledge workspace"
```

### Task 5: Add tenant Storage safety, parse/vector lifecycle and knowledge governance

**Files:**
- Create: `supabase/migrations/202608260038_knowledge_processing_lifecycle.sql`
- Modify: `supabase/tests/knowledge_access.sql`
- Create: `src/features/knowledge/document-processing-handler.ts`
- Create: `src/features/knowledge/document-processing-handler.test.ts`
- Modify: `src/features/files/file-command-handler.ts`
- Create: `src/app/api/workstation/knowledge/documents/[documentId]/reindex/route.ts`

**Interfaces:**
- Produces tenant-scoped object path, hash, MIME/size and `quarantined|scanning|ready|rejected` file lifecycle.
- Produces OCR/parse/vector jobs with source citation offsets, stale markers, delete cleanup and idempotent reindex commands.

- [ ] **Step 1: Write failing path, scan, parse, vector-permission and delete-cleanup tests**

```ts
expect(objectPath).toMatch(/^tenant\/[a-z0-9-]+\//);
expect((await publishQuarantinedDocument()).status).toBe(422);
expect(await searchAsUnrelatedMember()).not.toContainEqual(expect.objectContaining({ documentId }));
expect(await vectorsForDeletedVersion()).toHaveLength(0);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/knowledge/document-processing-handler.test.ts src/features/files/file-command-handler.test.ts`
Run: `npm run db:test`
Expected: scan/quarantine and parser/vector lifecycle are not yet durable.

- [ ] **Step 3: Implement controlled document processing**

Verify hash, type and size before admission; keep unsafe objects quarantined. Persist OCR/parse status and errors, index only accessible tenant-scoped published sources, retain versioned source citations, mark stale records, clean vector/object relations on authorized deletion and make reindex resumable/idempotent. Audit download, search and AI-source access; prohibit third-party model training by default.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/knowledge src/features/files`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/knowledge.spec.ts --project=chrome`
Expected: unsafe/oversize uploads fail, permission filtering holds through search/citation, and delete/reindex leaves no stale vector access.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260038_knowledge_processing_lifecycle.sql supabase/tests/knowledge_access.sql src/features/knowledge src/features/files/file-command-handler.ts src/app/api/workstation/knowledge tests/e2e/knowledge.spec.ts
git commit -m "feat: add governed knowledge processing lifecycle"
```
