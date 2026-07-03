# SiteSentry QA — Full Architecture & Code Audit

**Date:** 2026-07-04 (rev. 2 — second-pass self-audit applied same day)
**Scope:** Entire repository (`backend/`, `frontend/`), read-only audit. No code was modified during this session.
**Purpose:** Single source of truth for the next session's refactoring work. Every finding below is backed by exact `file:line` references verified against the current codebase.
**Rev. 2 changes:** corrected the "synchronously" wording in §2.1 (execution is asynchronous on the same event loop, same process); added H10 (progress reporting functionally broken — newly discovered and verified in the second pass); added L7-L9; added tasks T35-T38; demoted T33 from P2 to P3 with rationale; H10's fix assigned to Phase 1.
**Finding count:** 6 Critical, 10 High, 9 Medium, 9 Low = 34 findings; 38 ordered tasks (T01-T38).

---

## 1. Executive Summary

| Dimension | Score (1–10) | Notes |
|---|---|---|
| Overall health | **5.5** | Feature-rich, functionally complete, but built on architectural debt and a stack that no longer matches its own documentation. |
| Architecture | **5.0** | Clean plugin-style checker pattern; undermined by a worker/API process model that doesn't actually do what it's documented to do. |
| Maintainability | **5.0** | Good TypeScript strictness (`strict: true`, clean `tsc --noEmit`), but heavy copy-pasted config maps and checker logic. |
| Scalability | **3.5** | Single in-process, in-memory, non-durable queue; one Chromium instance processed at a time; no horizontal scaling path. |
| Production readiness | **3.0** | No auth, no rate limiting, SSRF exposure, near-zero test coverage on business-critical code, crash takes down the entire API. |
| Technical debt | **4.0** | Dead Prisma/BullMQ/Redis stack still shipped as dependencies; README describes a different product than what exists. |
| **Risk level** | **HIGH** if exposed beyond a trusted localhost/internal network; **MEDIUM** for pure local dev-tool usage. |

### Top 5 priorities for the next session

1. **Resolve the worker/API architecture lie.** `backend/src/api/server.ts:10` imports `../workers/index`, which means the API process *already* processes scan jobs in-process. The documented and scripted second "worker" terminal (`npm run dev:worker`) runs an entirely separate, disconnected queue instance that never receives real jobs. Decide deliberately: real process isolation, or an honest single-process model — then fix the docs/scripts to match reality.
2. **Remove dead legacy infrastructure.** `@prisma/client`, `prisma`, `bullmq`, `ioredis` are still real `dependencies` in `backend/package.json`; `backend/src/database/client.ts` and `backend/src/database/prisma/schema.prisma` are unused files; `backend/src/config.ts` is entirely dead code (nothing imports it) yet defines `REDIS_URL`/`DATABASE_URL`. `README.md` documents a Postgres+Prisma+Redis+BullMQ stack and a `npm run worker` script that doesn't exist. This is actively misleading to anyone onboarding.
3. **Close the security gaps before any non-local exposure.** No authentication on any endpoint. `POST /api/scan` accepts any URL with no allow/deny-list, so the headless browser will happily navigate to internal/private addresses (SSRF). No rate limiting on scan creation.
4. **Add real test coverage before refactoring further.** Only 2 trivial tests exist (directory creation, one DB column write). `ScanWorker.ts` (570 lines, the most complex/critical file), all 9 checkers, all API routes, and `PageAnalyzer.ts` have zero test coverage. The backend's own `npm test` script is `"echo \"Tests pendientes de implementar\""` — it doesn't even invoke Jest, despite a working `jest.config.js` and two real test files existing.
5. **Decompose `ScanWorker.ts`.** One 570-line function (`processScanJob`) does job orchestration, flow-step execution, screenshot capture, visual-regression pixel diffing, DB persistence, and anti-bot error classification — with the checker-execution/screenshot/ID-assignment logic duplicated almost verbatim between the flow-mode and non-flow-mode branches.

---

## 2. Architecture Breakdown

### 2.1 What actually happens end-to-end (verified, not assumed)

```
Frontend (Home.tsx)
  → POST /api/scan  (scan.ts, zod-validated)
      → INSERT scans row (status=PENDING)
      → getScanQueue().add('process-scan', {scanId, url, config})
         SimpleQueue.add() → pushes to in-memory array → calls processNext()
            processNext() → shift() → emitAsync('process', job)
               → the ONLY listener bound to 'process' is registered by
                 workers/index.ts, which server.ts imports directly at
                 server.ts:10 ("import '../workers/index';")
               → so the job is executed IN-PROCESS, inside the same Node
                 process that is running the Express API server.
                 (Asynchronously on the same event loop — processNext() is
                 fired without await from add(), so the HTTP handler is not
                 blocked, but the scan's CPU/IO load and any crash share
                 the API process.)
  ← 201 {id, status: PENDING}   (returned immediately; the scan is already
                                  running in the background of the same process)
Frontend polls GET /api/scan/:id/status every ~2s (Home.tsx:28-50)
  → once status=COMPLETED, fetches GET /api/reports/:id
```

Inside `processScanJob` (`ScanWorker.ts:200-570`):
1. `chromium.launch()` — new headless Chromium process per scan.
2. `PageAnalyzer.analyze(url)` — new browser context with anti-bot fingerprint, network/console interception, full-page scroll (`PageAnalyzer.ts:43-152`).
3. **Branch A — flow mode** (`ScanWorker.ts:241-399`): iterate `FlowStep[]`, execute click/type/navigate/wait/select/hover/press, run all 9 checkers + screenshot capture at each checkpoint/navigate/last-step.
4. **Branch B — normal mode** (`ScanWorker.ts:400-455`): run all 9 checkers once, capture full-page + per-HIGH-issue element screenshots.
5. Persist all `Issue[]` to SQLite in one transaction (`ScanWorker.ts:461-486`).
6. `runVisualRegression()` — best-effort pixelmatch diff of current vs. baseline screenshots, full-page and per-element (`ScanWorker.ts:31-198`).
7. Update `scans.status = COMPLETED`, close browser in `finally`.

A second terminal (`npm run dev:worker` → `workers/start.ts` → `import './index'`) starts an **entirely separate Node process** with its **own independent in-memory `scanQueue` singleton** (module state is per-process). That second process's queue never receives any jobs, because `queue.add()` is always called from within the API process against the API process's own queue instance, which the API process already knows how to drain (step 10 import). Running the documented "Terminal 2 — Worker" therefore does nothing.

### 2.2 Subsystem map

| Subsystem | Files | Role |
|---|---|---|
| HTTP API | `api/server.ts`, `api/routes/{scan,reports,flows}.ts` | Express app, CORS/helmet, zod validation (scan only), screenshot static serving with path-traversal guards |
| Queue | `queue/queue.ts` | In-memory `EventEmitter`-based FIFO, one job processed at a time, no persistence |
| Orchestration | `workers/index.ts`, `workers/start.ts`, `workers/ScanWorker.ts` | Registers the queue processor; `ScanWorker.ts` is the pipeline god-function |
| Browser layer | `analyzer/PageAnalyzer.ts` | Context creation with anti-bot fingerprint, network/console interception, scroll |
| Checkers | `checkers/*.ts` (9) + `index.ts` | Independent `IChecker` implementations, each doing its own `page.evaluate()`/network-event scan |
| Persistence | `database/db.ts` | `better-sqlite3`, schema via `CREATE TABLE IF NOT EXISTS` + inline try/catch `ALTER TABLE` migrations |
| Dead persistence | `database/client.ts`, `database/prisma/schema.prisma` | Unused Prisma client — no live import path anywhere |
| Types | `types/index.ts` (backend + frontend copies) | Enums + interfaces shared conceptually, duplicated by hand across the boundary |
| Frontend pages | `pages/Home.tsx`, `pages/Report.tsx` | Scan initiation + polling; report fetch + display |
| Frontend report UI | `components/ReportViewer`, `ErrorGroup`, `ErrorCard`, `FlowTabs`, `VisualDiffViewer`, `ScreenshotThumb`, `Lightbox` | Report rendering, filtering, export, visual diff display |
| Frontend flow tooling | `components/FlowEditor`, `services/codegenConverter.ts` | Flow authoring + Playwright-codegen import |
| Frontend services | `services/api.ts`, `services/ai.ts` | Axios client (no interceptors); Groq LLM client reading key from `localStorage` |

### 2.3 Data flow

`Scan request → SQLite scans row → in-memory queue (same process) → Playwright browser → PageAnalyzer → [flow engine] → 9 checkers → Issue[] → SQLite issues table (transaction) → screenshots on disk (data/screenshots/{scanId}/) → pixelmatch diff vs. baseline (best-effort) → visual_diffs table → GET /api/reports/:id assembles JSON (issues + summary + per-step + visualDiffs + baselineInfo) → frontend renders`.

### 2.4 Dependency flow / coupling

- `ScanWorker.ts` directly imports and orchestrates: `database/db`, `types`, `analyzer/PageAnalyzer`, `checkers`, plus `pixelmatch`/`pngjs`/`sharp` for visual regression — i.e., **one file owns five distinct concerns** with no interface boundaries between them (no `VisualRegressionService`, no `FlowEngine`, no `ScreenshotService` abstractions — everything is free functions and inline logic in one module).
- Checkers depend only on `types` (the `IChecker`/`Issue` contract) and Playwright's `Page` — genuinely decoupled from each other and from the worker, which is the strongest part of the architecture.
- Frontend components depend on `services/api.ts` (good) but re-derive presentation config (`typeConfig`, status labels, severity labels) independently in 3+ places instead of importing a shared source (bad — see Finding H3).
- `config.ts` is an orphaned dependency root: it exists, defines env-driven values, and nothing in the codebase imports it. Actual configuration is read ad hoc via `process.env.X` scattered across `server.ts`, `ScanWorker.ts`, `db.ts`, `scan.ts` — i.e., there are two competing (one dead) configuration patterns.

### 2.5 Strong areas

- **Checker plugin architecture**: `IChecker` interface + array-based registration in `checkers/index.ts` is a clean, low-coupling extension point — adding checker #10 genuinely only touches checker files + 2-3 documented frontend label maps.
- **`page.evaluate()` discipline**: 100% of the 16 evaluate call sites across the 7 checkers that use it correctly follow the mandated template-string IIFE + `var`/`function` convention documented in `CLAUDE.md` — verified by direct inspection, zero violations found. This is unusually disciplined for a constraint this easy to violate accidentally.
- **Path-traversal defenses**: the screenshot-serving route (`server.ts:88-116`) and baseline route (`server.ts:50-85`) both validate scan IDs against a UUID-shaped regex and reject `..`/`/`/`\` in filenames before touching the filesystem.
- **Zod validation on the scan-creation endpoint** (`scan.ts:10-32`) is a solid, well-typed contract — the one place in the backend that validates rigorously.
- **Anti-bot resilience**: `ScanWorker.ts:513-552` gracefully classifies HTTP/2-protocol-error style blocks into a user-facing `FAILED_API/HIGH` issue instead of a hard failure — good defensive product design.
- **Visual regression math** is genuinely correct and reasonably careful (dimension-mismatch handling via `sharp` resize before `pixelmatch`, best-effort try/catch around every diff so a diffing failure never fails the whole scan).

### 2.6 Weak areas

- Worker/queue architecture doesn't match its own documentation or scripts (Critical, §2.1).
- One god-function (`ScanWorker.processScanJob`) owns too many responsibilities with internal duplication between its two branches.
- No authentication, no rate limiting, no SSRF protection.
- Near-zero automated test coverage of anything that matters.
- Dead dependencies/files from a prior architecture (Prisma/BullMQ/Redis) left in place, inflating install size and confusing the mental model of the actual stack.
- Frontend has three independent, hand-maintained copies of the same enum-to-label mapping, already showing real textual drift.
- No CSS token system despite one being documented as intended.

---

## 3. Findings

Findings are ranked by severity. Each includes Problem / Impact / Why it exists / Long-term consequences / Recommended solution / Estimated complexity.

### CRITICAL

**C1 — API and "worker" are the same process; the documented worker process does nothing**
- **File:** `backend/src/api/server.ts:10` (`import '../workers/index';`), `backend/src/workers/index.ts:1-13`, `backend/src/workers/start.ts`, `backend/src/queue/queue.ts:64-70`
- **Problem:** `server.ts` imports `workers/index.ts` at module load, which registers the `scanQueue.on('process', ...)` listener in the API process. `queue.ts`'s `scanQueue` is a per-process module singleton, so the separate `npm run dev:worker` process has its own independent, permanently-empty queue.
- **Impact:** Every scan actually runs synchronously inside the HTTP server process. A Chromium crash or an unhandled exception during a scan can take down the entire API, not just one job. There is no real isolation, no independent scaling of scan throughput vs. API throughput, and the "worker" terminal instructions in `CLAUDE.md` and `README.md` are simply false.
- **Why it exists:** Almost certainly a leftover from a prior BullMQ+Redis architecture (where a second process genuinely would have picked up jobs from a shared Redis-backed queue) that was collapsed into an in-process `EventEmitter` queue without updating the process-topology assumptions or the docs.
- **Long-term consequences:** Anyone scaling this ("run 2 worker processes for throughput") will discover it silently doesn't work. Debugging "why is my worker not picking up jobs" will cost real engineering time. Trust in the documentation erodes.
- **Recommended solution:** Pick one of two honest models and implement it fully: (a) **single-process**: delete the worker scripts/docs, keep everything as it functionally already is, and document it accurately; or (b) **real isolation**: move job execution to a `child_process`/`worker_threads` boundary or a durable external queue, with the API process only enqueuing and the worker process being the only one that imports `workers/index.ts`.
- **Complexity:** Low for option (a) [docs + script cleanup]; Medium-High for option (b) [genuine process-boundary work].

**C2 — No authentication and no SSRF protection on scan targets**
- **File:** `backend/src/api/routes/scan.ts:35-97`, `backend/src/api/server.ts` (no auth middleware anywhere)
- **Problem:** `POST /api/scan` accepts any syntactically valid URL (`z.string().url()`, `scan.ts:20`) with no allow/deny-list, and no endpoint in the app requires authentication.
- **Impact:** Anyone with network access to the backend can direct the headless browser at internal/private network addresses (`http://localhost:*`, `http://169.254.169.254/...` cloud metadata endpoints, internal admin panels), then read back screenshots and network traffic of the response via the unauthenticated reports API — a textbook SSRF-to-data-exfiltration chain.
- **Why it exists:** Built as a local/internal dev tool where this risk wasn't in scope; no indication this was a deliberate accepted-risk decision (not documented anywhere).
- **Long-term consequences:** Becomes a serious liability the moment this is deployed anywhere reachable outside a fully trusted network segment.
- **Recommended solution:** Add an IP/hostname denylist (RFC1918 ranges, `169.254.0.0/16`, `localhost`) resolved before navigation, plus basic auth or an API-key middleware gate on all `/api/*` routes, at minimum before any shared/hosted deployment.
- **Complexity:** Medium (denylist resolution needs to handle DNS rebinding carefully; auth middleware itself is low complexity).

**C3 — In-memory queue has no durability or crash recovery**
- **File:** `backend/src/queue/queue.ts:11-40`
- **Problem:** `SimpleQueue.jobs` is a plain in-memory array. If the process restarts (crash, deploy, `tsx watch` reload) while jobs are queued-but-not-started, they vanish with no trace — but the corresponding `scans` row was already written as `PENDING` (`scan.ts:73-74`) before/around enqueue.
- **Impact:** Scans can get permanently stuck showing `PENDING` in the UI forever after any restart during high load, with no operator-visible error and no automatic recovery.
- **Why it exists:** Natural consequence of replacing BullMQ+Redis (durable) with a minimal in-process `EventEmitter` queue (non-durable) without adding a compensating recovery mechanism.
- **Long-term consequences:** Silent data/UX inconsistency that's hard to diagnose ("why did my scan never finish?") and erodes trust in scan results.
- **Recommended solution:** On worker/API startup, requeue any `scans` rows still in `PENDING`/`RUNNING` state from a previous run (with a max-retry or "mark as FAILED after N minutes stale" guard). This is a cheap, high-value reliability fix given SQLite is already the source of truth.
- **Complexity:** Low-Medium.

**C4 — Near-zero test coverage on all business-critical logic; the test script is a no-op**
- **File:** `backend/package.json` (`"test": "echo \"Tests pendientes de implementar\""`), `backend/src/__tests__/screenshots-capture.test.ts`, `backend/src/__tests__/screenshots-db.test.ts`, `backend/jest.config.js`
- **Problem:** Only 2 trivial tests exist (filesystem directory creation; one SQLite column round-trip). `ScanWorker.ts` (570 lines, the pipeline core), all 9 checkers, all API routes, `PageAnalyzer.ts`, and `queue.ts` have zero tests. The `npm test` script doesn't even invoke Jest — `npx jest --no-coverage` (as documented in `CLAUDE.md`) must be run manually and isn't wired into `npm test`.
- **Impact:** Any refactor of the pipeline (which is exactly what's planned next) has no regression safety net. The audit's own §6 ("things that must not change") cannot be mechanically verified without tests.
- **Why it exists:** Feature velocity was prioritized; test infrastructure (Jest, ts-jest, config) was set up but never followed through.
- **Long-term consequences:** Refactoring risk compounds — every future change is a leap of faith. This is the single biggest blocker to safely executing the rest of this roadmap.
- **Recommended solution:** Before any structural refactor: (1) wire `npm test` to actually run Jest; (2) add characterization tests for `ScanWorker.processScanJob` (mocked Playwright) and each checker (given a fixed HTML fixture, assert issue types/counts); (3) add route-level tests for `scan.ts`/`reports.ts`/`flows.ts` using an in-memory/temp SQLite DB.
- **Complexity:** Medium-High (meaningful upfront investment, but this is Phase 7 in the roadmap below and should happen before Phases 2-6 touch the pipeline internals it covers).

**C5 — Dead legacy stack shipped as real dependencies and files**
- **File:** `backend/package.json` (`@prisma/client`, `prisma`, `bullmq`, `ioredis` in `dependencies`/`devDependencies`), `backend/src/database/client.ts`, `backend/src/database/prisma/schema.prisma`, `backend/src/config.ts`
- **Problem:** None of these are imported by any live code path (verified via grep — `config.ts` has zero importers; `database/client.ts` only self-references the Prisma schema; nothing in `src/` imports `bullmq` or `ioredis`).
- **Impact:** Inflated `node_modules`, a misleading mental model for anyone reading `package.json` to understand the stack, and `config.ts` advertising `REDIS_URL`/`DATABASE_URL` env vars that do nothing — an operator could "configure" these and see no effect, with no error to explain why.
- **Why it exists:** Leftover from the pre-migration architecture (Postgres+Prisma+Redis+BullMQ → SQLite+in-process-queue), not cleaned up when the migration completed (per `CLAUDE.md`'s own "Runtime Environment" section, which says this migration already happened).
- **Long-term consequences:** Every future engineer (or agent) has to re-discover that these are dead, costing time repeatedly.
- **Recommended solution:** Delete `database/client.ts`, `database/prisma/` entirely, `config.ts`; remove `@prisma/client`, `prisma`, `bullmq`, `ioredis` from `package.json`; run `npm install` to update the lockfile.
- **Complexity:** Low.

**C6 — README.md documents a stack and workflow that no longer exist**
- **File:** `README.md:9-49`
- **Problem:** README states Queue = BullMQ+Redis, Database = PostgreSQL(Supabase)+Prisma, and gives setup steps (`npm run prisma:generate`, `npm run prisma:migrate`, `cp .env.example .env` configuring `DATABASE_URL`/`REDIS_URL`) and a "Terminal 2 — Worker" step using `npm run worker`, which is not a defined script (`package.json` only has `dev:worker`).
- **Impact:** Anyone (human or agent) following `README.md` literally will fail at the first `npm run prisma:generate` step (no working Postgres configured) and will run a nonexistent script for the worker.
- **Why it exists:** Same root cause as C5 — README wasn't updated when the stack migrated. `CLAUDE.md` (the canonical instructions for AI agents) is accurate; `README.md` (the canonical instructions for humans) is not.
- **Long-term consequences:** Onboarding friction, contributor distrust, agents given only `README.md` context will actively do the wrong thing.
- **Recommended solution:** Rewrite `README.md` to match `CLAUDE.md`'s "Runtime Environment"/"Commands" sections (SQLite, in-process queue, 3-terminal reality once C1 is resolved).
- **Complexity:** Low.

### HIGH

**H1 — `ScanWorker.processScanJob` is a 570-line god function with duplicated branches**
- **File:** `backend/src/workers/ScanWorker.ts:200-570`
- **Problem:** One function handles: browser lifecycle, flow-step execution engine (`:285-389`), checker orchestration (duplicated at `:348-360` for flow mode and `:405-413` for normal mode), screenshot capture (duplicated at `:362-387` and `:420-452`), issue-ID assignment (duplicated at `:392-397` and `:416-418`), DB persistence, visual regression invocation, and anti-bot error classification (`:513-552`) — five-plus distinct responsibilities in one module with no extracted collaborators.
- **Impact:** Any change to "how screenshots are captured" or "how checkers are run" must be made twice (once per branch) and is easy to apply asymmetrically, as has arguably already started (the two branches are not byte-identical in structure).
- **Why it exists:** Flow-mode support (Phase 3 per `CLAUDE.md`) was likely added by branching the original non-flow pipeline rather than refactoring it into a shared engine parameterized by "run once" vs. "run per checkpoint."
- **Long-term consequences:** Bug-fix drift between the two modes; growing cost of adding a 10th checker or a new capture concern; hard to unit-test in isolation.
- **Recommended solution:** Extract `FlowEngine` (step execution), `CheckerRunner` (run all checkers + collect issues, used by both modes with a single "checkpoint" concept — normal mode is just a 1-checkpoint flow), `ScreenshotService`, and `VisualRegressionService` as separate, independently testable modules; have `processScanJob` become a thin orchestrator.
- **Complexity:** High (touches the most critical file; must be done under test coverage from C4 first).

**H2 — Checker severity assignment is methodologically inconsistent across all 9 checkers**
- **File:** `AccessibilityChecker.ts:6-11` (static impact map), `ConsoleErrorChecker.ts:17-31,52-53` (pattern-array heuristic), `ContentChecker.ts:45,76,104` (fixed HIGH always), `InteractivityChecker.ts:34,58,86` / `FormModalChecker.ts:39,47,82,114` / `LazyLoadChecker.ts:33,66,90` (fixed constant per subtype), `PerformanceChecker.ts:40-132` (5 independent numeric threshold-ladders)
- **Problem:** No shared severity-policy module exists. Five different strategies for deciding HIGH/MEDIUM/LOW coexist with no reconciling logic.
- **Impact:** Tuning "what counts as HIGH" globally (a very plausible product requirement — e.g., a customer wants stricter thresholds) currently requires touching up to 9 files with 5 different mental models, and there's no way to verify consistency.
- **Why it exists:** Checkers were built incrementally, each solving its own detection problem without a shared severity abstraction being designed up front.
- **Long-term consequences:** Increasing checker count makes this worse linearly; severity becomes progressively harder to reason about or make configurable (e.g., per-scan custom thresholds).
- **Recommended solution:** Introduce a small `severity/` module with named policies (`fixedSeverity(X)`, `thresholdLadder(metric, {high, medium})`, `mapBy(lookupTable)`) that every checker composes from, without changing any checker's actual output values.
- **Complexity:** Medium (behavior-preserving refactor — must produce byte-identical severities, verified by tests from C4).

**H3 — Frontend has three drifted copies of IssueType→label/icon, ScanStatus→label, and Severity→label**
- **File:** `ReportViewer.tsx:392-422` (`getTypeIcon`/`getTypeLabel`), `ErrorGroup.tsx:13-24` (`typeConfig`), `ErrorCard.tsx:26-37` (`typeConfig`); `Home.tsx:304-312` (`getStatusLabel`), `ReportViewer.tsx:158-163` (inline `statusLabel`), `ScanProgress.tsx:20-35` (`getStatusMessage`); severity labels in `ReportViewer.tsx:48,75` vs. `ErrorCard.tsx:20-24`
- **Problem:** `CLAUDE.md:227-229` documents the IssueType triplication as a known, accepted 3-step manual sync process — but it has already drifted: `BROKEN_RESOURCE`/`FAILED_API`/`FORM_MODAL`/`CONSOLE_ERROR` render with plural labels in two components and singular in the third. `ScanStatus` labels differ in wording (`'Ejecutando'` vs. `'En ejecucion'`) between `Home.tsx` and `ReportViewer.tsx` for the same `RUNNING` state — this one isn't even documented as an accepted duplication.
- **Impact:** A user sees inconsistent terminology for the identical underlying value depending on which screen they're on — a visible quality bug, not just an internal code-smell.
- **Why it exists:** No shared constants module for enum-derived presentation data; each component authored its own copy at the time it was built.
- **Long-term consequences:** Every new `IssueType`/status value is 3+ more places to remember to update (already true and already missed at least 4 times for wording).
- **Recommended solution:** One shared `frontend/src/config/issueTypeConfig.ts` (label + icon + color) and `scanStatusConfig.ts`, imported everywhere; delete the 3 local copies.
- **Complexity:** Low-Medium (pure frontend, mechanical, low risk — a good "quick win" early task).

**H4 — No rate limiting or backpressure on scan creation**
- **File:** `backend/src/api/routes/scan.ts:35-97`, `backend/src/queue/queue.ts:16-22`
- **Problem:** `POST /api/scan` has no per-IP or global throttle. Each accepted scan launches a full headless Chromium (`ScanWorker.ts:214-222`). The queue serializes execution (one job at a time via `processNext`'s while-loop) but places no cap on how many jobs can be *enqueued* simultaneously.
- **Impact:** A client (malicious or just a buggy retry loop) can queue an unbounded number of scans; because SQLite writes a `scans` row per request even before queuing, this also grows the DB unboundedly, and users see ever-growing wait times with no visibility into queue depth.
- **Why it exists:** Not addressed as part of the SSRF/auth gap generally (C2) — this is the resource-exhaustion sibling of that same "no gatekeeping" problem.
- **Long-term consequences:** A single misbehaving client can degrade the tool for all other users of a shared deployment.
- **Recommended solution:** Add `express-rate-limit` (or equivalent) on `POST /api/scan`; consider a max-queue-depth rejection (`503` once `jobs.length` exceeds a configurable cap).
- **Complexity:** Low.

**H5 — Weak typing at the `Issue`/`ReportResponse` boundary**
- **File:** `backend/src/types/index.ts:30-38` (`Issue` interface has no `id`/`stepIndex`), `ScanWorker.ts:332,353,375-377,394-396,417,470` (`id`/`stepIndex` bolted on via `(issue as any).id`/`.stepIndex`), `types/index.ts:102-113` (`ReportResponse.issues[]` type omits `stepIndex` even though `reports.ts:83` returns it), `types/index.ts:71-75` vs. `:119-123` (`StepResult.summary` uses `Record<string, number>`, `ReportResponse.summary` uses `Record<IssueType, number>`/`Record<IssueSeverity, number>` for the conceptually identical shape)
- **Problem:** The core `Issue` type doesn't model fields that are used and returned in practice, forcing `as any` at every mutation site; the top-level API response type is more strictly typed than its own nested per-step type for the same data shape.
- **Impact:** The compiler cannot catch a typo in `stepIndex` (it already isn't part of the checked type), and the frontend consuming this API has no compile-time guarantee it matches — this is exactly the kind of gap that produces a runtime `undefined` bug that TypeScript exists to prevent.
- **Why it exists:** `id`/`stepIndex` were added incrementally (Phase 1 screenshots, Phase 3 flows) as bolt-ons rather than as part of a type revision.
- **Long-term consequences:** Compounds with every future field added the same way; erodes the value of `strict: true`.
- **Recommended solution:** Add `id: string` and `stepIndex?: number` directly to the `Issue` interface; unify `StepResult.summary`/`ReportResponse.summary` to share one `Summary` type keyed by the enums.
- **Complexity:** Low (type-only change; verify no consumer relied on the field being absent).

**H6 — Ad hoc, unversioned DB migrations**
- **File:** `backend/src/database/db.ts:50-128`
- **Problem:** Schema evolution is five sequential `try { db.exec('ALTER TABLE...') } catch (e) { if (!e.message.includes('...')) console.warn(...) }` blocks appended to `getDb()`, matched on the SQLite error *message string* to detect "already applied."
- **Impact:** No migration version is tracked anywhere; every server boot re-attempts every historical `ALTER TABLE`/`CREATE TABLE`, relying on string-matching SQLite's error text (`'duplicate column name'`, `'already exists'`) as the idempotency mechanism — a SQLite version change that alters error wording would silently break this.
- **Why it exists:** Reasonable stop-gap for a SQLite-only, single-file-DB project without introducing a migration framework, but has now grown to 5 blocks and will keep growing.
- **Long-term consequences:** No way to know "what schema version is this DB at" without reading all of `db.ts`; no rollback story; growing boot-time cost (small today, but linear in migration count forever).
- **Recommended solution:** Introduce a minimal `schema_migrations` table tracking applied migration IDs, with each migration as a small numbered function — same `better-sqlite3` primitives, just with explicit version tracking instead of error-message sniffing.
- **Complexity:** Medium.

**H7 — Groq API key stored in plaintext localStorage with no backend proxy or CSP**
- **File:** `frontend/src/components/Settings/Settings.tsx:19`, `frontend/src/services/ai.ts:5-12,37-52`
- **Problem:** The Groq API key is saved via `localStorage.setItem('sitesentry_groq_api_key', ...)` and sent directly from the browser (`Authorization: Bearer <key>`) straight to Groq's API. `index.html` has no CSP meta tag.
- **Impact:** Any future XSS vulnerability (or malicious browser extension) can read `localStorage` and exfiltrate the user's Groq API key — and there's currently no rendered-URL sanitization for scanned-page-derived `href`s (`ErrorCard.tsx:109,117`, `ReportViewer.tsx:186`) which is the most plausible XSS-adjacent vector if it were ever to combine with an unescaped-render bug.
- **Why it exists:** Simplest implementation for a client-only feature; not flagged as a tradeoff anywhere in code or docs.
- **Long-term consequences:** Low likelihood today (no XSS vector currently found), but the blast radius if one is introduced later is a leaked third-party API key with billing implications for the user.
- **Recommended solution:** At minimum, add a CSP meta tag; ideally proxy Groq calls through the backend (which already validates input) so the API key never touches the browser at all.
- **Complexity:** Medium (proxying requires a new backend route + moving key storage server-side).

**H8 — Inconsistent input validation: zod on `scan.ts`, hand-rolled on `flows.ts`, and flow steps can silently no-op**
- **File:** `backend/src/api/routes/flows.ts:55-78,81-99` (manual checks, only verifies `steps[i].action` is truthy — not that it's one of the 8 valid actions), vs. `scan.ts:10-17` (zod `z.enum([...])` for the same conceptual field when a flow is submitted inline); `ScanWorker.ts:291-320` (if/else-if chain with no `else` branch for an unrecognized `action`)
- **Problem:** A flow saved via `POST /api/flows` can contain a step with `action: "clikc"` (typo) or missing required fields for its action type, and this passes flows.ts's validation. When later executed by `ScanWorker.ts`, the if/else-if chain simply matches nothing and the step silently does nothing — no error, no issue recorded, no log distinguishing "this step was skipped" from "this step succeeded with no visible effect."
- **Impact:** A user can save and run a broken flow and get a report that looks clean (fewer issues found) when in reality a step never executed — a correctness bug disguised as a clean scan.
- **Why it exists:** `flows.ts` predates or wasn't updated alongside the stricter `FlowStepSchema` already defined in `scan.ts:10-17`.
- **Long-term consequences:** Silent data quality issues that erode trust in scan results specifically for the flow feature, which is the most complex/valuable feature in the product.
- **Recommended solution:** Reuse `scan.ts`'s `FlowStepSchema`/`ScanRequestSchema`-style zod validation in `flows.ts` (extract to a shared schema module); add an `else` branch in `ScanWorker.ts`'s step executor that records a `FLOW_ERROR` issue for unrecognized/malformed steps instead of silently continuing.
- **Complexity:** Low-Medium.

**H9 — 16 redundant `page.evaluate()` round-trips per scan across the 9 checkers**
- **File:** All 7 evaluate-using checkers (`BrokenResourcesChecker.ts:37,74`; `ContentChecker.ts:11,52,83`; `FailedAPIChecker.ts:51`; `FormModalChecker.ts:11,55,90`; `InteractivityChecker.ts:11,41,65`; `LazyLoadChecker.ts:11,40,73`; `PerformanceChecker.ts:20`)
- **Problem:** Each checker independently re-queries overlapping DOM surface (multiple full `img` scans, a full `querySelectorAll('*')` pass in both `PerformanceChecker` and `BrokenResourcesChecker`, repeated `getComputedStyle` calls for visibility checks in 6 of 9 checkers) via its own separate browser IPC round-trip, with no shared single-pass DOM snapshot.
- **Impact:** Direct, measurable per-scan latency cost — this is a browser-automation product where scan speed is a first-order UX metric, and this is the most concrete, low-risk performance win available (behavior-preserving: same detections, fewer round-trips).
- **Why it exists:** Checkers were designed to be fully independent (a genuine architectural strength for maintainability) with no thought given to a shared "collect once, checkers subscribe" DOM-facts layer.
- **Long-term consequences:** Cost grows linearly with each new checker added.
- **Recommended solution:** Introduce an optional `PageFacts` pre-pass (one evaluate call collecting images/visibility/DOM-node-count/etc.) that checkers can consume instead of querying themselves — but only where it doesn't compromise the current per-checker isolation/testability; this should be scoped carefully, not a wholesale rewrite.
- **Complexity:** Medium-High (must preserve exact current detection behavior — do only after H2/C4 give a safety net).

**H10 — Scan progress reporting is functionally broken: the active job is invisible to the status endpoint**
- **File:** `backend/src/queue/queue.ts:24-26` (`getJobs()` returns `this.jobs`), `queue.ts:32` (`processNext()` does `this.jobs.shift()` **before** processing), `backend/src/api/routes/scan.ts:117-129` (status route searches `getJobs(['active','waiting'])` for the scan's job to read `job.progress`), `frontend/src/components/ScanProgress/ScanProgress.tsx:12-27` (renders `progress.phase` labels)
- **Problem:** `SimpleQueue.processNext()` removes a job from the `jobs` array via `shift()` and *then* processes it. `getJobs()` returns only the remaining array. Therefore the currently-executing job — the only one whose `progress` is ever populated by `updateProgress` (`workers/index.ts:6-8`) — can never be found by the status endpoint's lookup. Jobs still waiting in the array have `progress: null`. Net result: `GET /api/scan/:id/status` returns `progress: null` in 100% of cases.
- **Impact:** The entire progress-phase feature (`launching_browser` / `loading_page` / `running_checks` / `saving_results` phase labels, and the per-step flow progress documented in `CLAUDE.md` — "GET status with per-step progress") is dead code end-to-end. Users always see the generic fallback `'Analizando pagina...'` (`ScanProgress.tsx:25`). This is a shipped, documented feature that silently does not work.
- **Why it exists:** The `SimpleQueue` mimics BullMQ's `getJobs(['active','waiting'])` API surface but not its semantics — BullMQ keeps active jobs queryable; the in-memory replacement discards them from the queryable set at the moment they become active. The `_types` parameter is accepted and ignored (`queue.ts:24`), which masked the mismatch.
- **Long-term consequences:** Any future feature built on job progress (ETAs, cancel-while-running, queue-depth display) will silently fail the same way. Also invalidates manual QA of the progress UI ("it shows *something*, so it works").
- **Recommended solution:** Track the active job in the queue (e.g., an `activeJob` field set before processing, cleared after; `getJobs()` returns `[...this.jobs, activeJob]` filtered by type) — or, more robustly, persist progress to the `scans` row and have the status endpoint read it from SQLite, which also survives the process-model change from C1/T04-T05.
- **Complexity:** Low (queue-side fix) to Medium (SQLite-persisted progress, recommended if C1 option (b) is chosen).

### MEDIUM

**M1 — Frontend has no centralized state management; `Home.tsx`/`ReportViewer.tsx` mix multiple responsibilities**
- **File:** `Home.tsx` (9 separate `useState`, 312 lines total, mixes scan orchestration + polling + flow selection + static marketing JSX at `:166-249`); `ReportViewer.tsx` (430 lines, mixes JSON export `:26-56`, CSV export `:58-89`, filtering `:140-146`, grouping `:148-152`, score calc `:169-177`, duration formatting `:424-430`, and the H3 label maps, all in one component)
- **Impact:** Harder to test/reason about each concern in isolation; `currentScan`/`scanStatus` (`Home.tsx`) always change together but aren't modeled as one state unit.
- **Recommended solution:** Extract `exportJSON`/`exportCSV`/`formatDuration`/`getScore` to `frontend/src/utils/report.ts`; consider `useReducer` for the tightly-coupled scan-lifecycle state in `Home.tsx`.
- **Complexity:** Medium.

**M2 — Baseline toggle forces a full page reload, discarding all UI state**
- **File:** `ReportViewer.tsx:129-138` (`handleToggleBaseline`, `window.location.reload()` at line 134)
- **Impact:** Defeats the SPA model; user loses their current filter/step/search selection for a one-field DB update.
- **Recommended solution:** Re-fetch just the report and update local state instead of a hard reload.
- **Complexity:** Low.

**M3 — `Report.tsx` fetch effect has no abort/ignore guard (stale-response race)**
- **File:** `pages/Report.tsx:16-46`
- **Impact:** If `id` changes rapidly or the component unmounts mid-request, a stale response can still call `setReport` after a newer fetch started.
- **Recommended solution:** Add an `AbortController` or `let ignore=false` cleanup guard, standard React data-fetching pattern.
- **Complexity:** Low.

**M4 — No CSS custom-properties/design-token system despite one being documented as intended**
- **File:** All `*.css` files under `frontend/src/` (zero `:root {}`/`--*` custom properties found); `CLAUDE.md:247-282` documents an intended token table that isn't implemented
- **Impact:** The same hex values (`#e2e8f0` border, `#2563eb` primary, `#94a3b8` muted text, etc.) are hardcoded 20-30+ times each across 12+ files; a brand color change requires a find-and-replace across the whole frontend instead of one variable edit.
- **Recommended solution:** Add a `:root {}` block in `index.css` with CSS custom properties matching the already-documented token table; replace hardcoded hex values file-by-file.
- **Complexity:** Medium (mechanical but touches every CSS file; best done incrementally, one component at a time, with visual diffing to confirm no regression).

**M5 — Duplicated DOM-scanning idioms across checkers with no shared helpers**
- **File:** Visibility-check idiom (`ContentChecker.ts:62`, `FormModalChecker.ts:65,99-100`, `LazyLoadChecker.ts:50`, `InteractivityChecker.ts:19-20` — with inconsistent opacity checks between copies); `img[src="..."]` selector construction (`BrokenResourcesChecker.ts:65`, `LazyLoadChecker.ts:36,93`); className-substring extraction (`ContentChecker.ts:27,93`, `LazyLoadChecker.ts:54`); "already reported" de-dup guard (`BrokenResourcesChecker.ts:51,94`, `FailedAPIChecker.ts:62`)
- **Impact:** Bug fixes to one copy (e.g., the opacity-check inconsistency) don't propagate to siblings; genuine functional drift risk (the visibility check already differs slightly between files).
- **Recommended solution:** Extract shared evaluate-string snippet builders (careful: must remain compatible with the `var`/`function`-only-inside-evaluate constraint) or a shared TS-side helper for the non-evaluate parts (selector construction, de-dup).
- **Complexity:** Medium.

**M6 — Inconsistent internal error handling across checkers**
- **File:** `AccessibilityChecker.ts:38-73` (has an internal try/catch, redundant with `ScanWorker.ts:405-412`'s outer catch) vs. the other 8 checkers (rely solely on the outer pipeline-level catch)
- **Impact:** Not a functional bug (the outer catch protects the pipeline either way) but an inconsistent defensive-programming policy that makes it unclear whether a given checker is expected to fail gracefully on its own.
- **Recommended solution:** Standardize on relying on the outer pipeline catch only (remove the redundant inner one), or standardize on every checker having one — pick one policy and apply it uniformly.
- **Complexity:** Low.

**M7 — `ErrorBoundary` only wraps `<ReportViewer>`, not the app root**
- **File:** `components/ErrorBoundary.tsx` (correctly implemented), wired only at `pages/Report.tsx:83-94`; `App.tsx:6-16` and `main.tsx:6-10` have no boundary
- **Impact:** A render error in `Home.tsx`, `Settings.tsx`, or `Report.tsx`'s own loading/error branches produces a blank white screen with no fallback UI.
- **Recommended solution:** Wrap `<Routes>` in `App.tsx` with the existing `ErrorBoundary` (it's already built, just under-deployed).
- **Complexity:** Low.

**M8 — Duplicated ad hoc error-unwrapping logic across frontend call sites**
- **File:** `Home.tsx:82-88`, `Report.tsx:31-38`, `ErrorCard.tsx:80-82` — three different manual `err?.response?.data?.error || ...` chains
- **Impact:** Inconsistent error messages shown to users for conceptually identical axios failures; any future change to the backend error envelope shape requires updating multiple call sites.
- **Recommended solution:** Add an axios response interceptor or a shared `unwrapApiError(err)` helper in `services/api.ts`.
- **Complexity:** Low.

**M9 — Naive UUID-shaped regex used for ID validation**
- **File:** `server.ts:55,92` — `/^[a-f0-9-]{36}$/`
- **Impact:** Accepts many 36-character hex/dash strings that aren't valid UUIDs (wrong version/variant nibbles); low real risk since it's always paired with a DB existence check, but imprecise as a security control.
- **Recommended solution:** Use a proper UUID validator (`crypto.randomUUID()`'s own format, or a small regex with version/variant constraints) if this is meant to be a real gate rather than just a sanity filter.
- **Complexity:** Low.

### LOW

**L1 — `getScanQueue()` typed to return `SimpleQueue | null` but never returns null**
- **File:** `queue.ts:66-68`, dead-code 503 branch at `scan.ts:77-79`
- **Recommended solution:** Simplify the type/return-null branch, or intentionally implement a real "queue unavailable" condition if one is ever needed.
- **Complexity:** Trivial.

**L2 — `FlowEditor.tsx` repeats near-identical `<input>` blocks per action type**
- **File:** `FlowEditor.tsx:66-79`
- **Recommended solution:** Extract a small `<StepField>` sub-component.
- **Complexity:** Low.

**L3 — Screenshot URL path construction duplicated instead of centralized**
- **File:** `ScreenshotThumb.tsx:16`, `VisualDiffViewer.tsx:36,39,68`
- **Recommended solution:** One `getScreenshotUrl(path)` helper in `services/api.ts`.
- **Complexity:** Trivial.

**L4 — Verbose `console.error` debug logging left in `Report.tsx`, ungated**
- **File:** `Report.tsx:26-38`
- **Recommended solution:** Gate behind `import.meta.env.DEV` or remove.
- **Complexity:** Trivial.

**L5 — Default `helmet()` CSP left un-tailored**
- **File:** `server.ts:23-25`
- **Recommended solution:** Not urgent today (no inline scripts/styles served by this API), but worth an explicit CSP policy statement once the frontend is served through/near this backend in production.
- **Complexity:** Low.

**L6 — Jest coverage config exists but is never invoked by CI or `npm test`**
- **File:** `jest.config.js` (`collectCoverageFrom`), `package.json` test script
- **Recommended solution:** Resolved as part of C4.
- **Complexity:** Trivial (subsumed by C4).

**L7 — `PageAnalyzer.close()` closes the page but never the `BrowserContext` it created**
- **File:** `analyzer/PageAnalyzer.ts:45-60` (context created in `analyze()`), `:187-189` (`close()` only calls `page.close()`)
- **Impact:** Bounded today — `ScanWorker` closes the whole browser per scan in its `finally` (`ScanWorker.ts:565-569`), so contexts die with it. But the asymmetric lifecycle (analyzer creates the context, nobody explicitly closes it) becomes a real leak the moment anyone reuses a browser across scans — which is a plausible optimization someone will attempt.
- **Recommended solution:** `close()` should close `page.context()` (which closes its pages), making the analyzer's lifecycle self-contained.
- **Complexity:** Trivial.

**L8 — Unvalidated `parseInt` on pagination params can produce `NaN` → 500**
- **File:** `api/routes/reports.ts:11-12` — `parseInt(req.query.offset as string || '0', 10)` with no `isNaN` guard; `?offset=abc` yields `NaN`, which `better-sqlite3` rejects, surfacing as a 500 instead of a 400.
- **Recommended solution:** Validate with zod (consistent with `scan.ts`) or clamp `Number.isNaN` values to defaults.
- **Complexity:** Trivial.

**L9 — `Home.tsx` polling interval is torn down and recreated on every poll tick**
- **File:** `pages/Home.tsx:28-50` — the effect's dependency array includes `scanStatus`, which is set inside the interval callback (`:35`), so each 2s tick re-runs the effect: cleanup clears the interval and a new one is created. Functionally harmless (next tick still lands ~2s later) but churny, and any future logic added to the effect body will run once per tick rather than once per scan.
- **Recommended solution:** Depend only on `currentScan?.id`; read the latest status via a ref, or move the terminal-state check inside the callback (it already is — `:36-43` — so `scanStatus` can simply be dropped from the deps along with the early-return at `:30`).
- **Complexity:** Low.

---

## 4. Refactoring Roadmap

Each phase is designed to be executable independently, with earlier phases reducing risk for later ones. **Phase order matters**: testing infrastructure (Phase 7 objectives) should be pulled forward and applied incrementally *within* Phases 1-3, not deferred to the end — see the Execution Order in §5 for the actual recommended sequencing, which interleaves test-writing with each risky change rather than batching it all at the end.

### Phase 1 — Architecture Foundation
- **Objectives:** Resolve C1 (worker/API truth), remove dead legacy stack (C5), fix README (C6), add crash recovery for orphaned PENDING/RUNNING scans (C3), repair broken progress reporting (H10 — its fix depends directly on the C1 process-model decision, so it belongs here).
- **Files affected:** `api/server.ts`, `workers/index.ts`, `workers/start.ts`, `queue/queue.ts`, `api/routes/scan.ts` (progress lookup), `database/client.ts` (delete), `database/prisma/` (delete), `config.ts` (delete), `package.json` (backend), `README.md`.
- **Estimated effort:** 1-2 days.
- **Dependencies:** None — this is the correct starting point.
- **Risks:** If choosing real process isolation (C1 option b), this is a genuine architecture change touching how jobs are dispatched; must be done carefully with manual end-to-end verification (no automated tests exist yet for this path).
- **Expected benefits:** Documentation and reality converge; removes an entire class of "why doesn't the worker pick up jobs" confusion; closes the crash-data-loss gap.

### Phase 2 — Security Hardening
- **Objectives:** C2 (auth + SSRF denylist), H4 (rate limiting), H7 (Groq key handling improvement or explicit accepted-risk documentation).
- **Files affected:** `api/server.ts`, `api/routes/scan.ts`, new `middleware/` directory, `frontend/src/services/ai.ts`, `frontend/src/components/Settings/Settings.tsx`.
- **Estimated effort:** 2-4 days depending on how far auth goes (simple API key vs. full user accounts — likely out of scope; recommend API key gate only).
- **Dependencies:** None, but should land before any deployment beyond localhost.
- **Risks:** SSRF denylist logic must correctly handle DNS rebinding (resolve-then-check, not just string-match the hostname) to be actually effective.
- **Expected benefits:** Removes the two most serious "must fix before going anywhere near production" gaps.

### Phase 3 — Backend Pipeline Cleanup
- **Objectives:** H1 (decompose `ScanWorker.ts`), H8 (unify flow-step validation, add error branch for unrecognized actions), H6 (versioned migrations).
- **Files affected:** `workers/ScanWorker.ts` (split into `FlowEngine.ts`, `CheckerRunner.ts`, `ScreenshotService.ts`, `VisualRegressionService.ts`), `api/routes/flows.ts`, `api/routes/scan.ts` (extract shared zod schema), `database/db.ts` (migration tracking).
- **Estimated effort:** 4-6 days.
- **Dependencies:** **Must follow Phase 7's initial characterization tests for `ScanWorker`** (pulled forward — see §5) so the decomposition is behavior-verified, not just visually reviewed.
- **Risks:** This is the highest-risk phase — it's the god-file. Any behavioral drift between flow/non-flow paths introduced during extraction would be a regression, not an improvement.
- **Expected benefits:** Each concern becomes independently testable and reasoned-about; eliminates the duplicated-branch maintenance burden (H1).

### Phase 4 — Checker Consistency
- **Objectives:** H2 (shared severity-policy module), M5 (shared DOM-scan helpers), M6 (standardize error-handling policy).
- **Files affected:** All 9 files in `checkers/`, new `checkers/severity.ts`, possibly `checkers/domHelpers.ts`.
- **Estimated effort:** 3-5 days.
- **Dependencies:** Should follow Phase 7's per-checker characterization tests (behavior-preserving refactor needs a safety net given 9 files with methodologically different logic).
- **Risks:** Must produce byte-identical severity/issue output for existing test fixtures — this is a pure internal-quality refactor, not a behavior change (see §6).
- **Expected benefits:** Adding checker #10 becomes cheaper and more consistent; severity tuning becomes a single-module change instead of a 9-file hunt.

### Phase 5 — Frontend Architecture
- **Objectives:** H3 (unify IssueType/ScanStatus/Severity label config), M1 (extract report utils, consider `useReducer` for scan lifecycle), M2 (remove hard reload on baseline toggle), M3 (fetch race guard), M7 (wire `ErrorBoundary` at app root), M8 (shared API error unwrapping).
- **Files affected:** New `frontend/src/config/{issueTypeConfig,scanStatusConfig}.ts`, `ReportViewer.tsx`, `ErrorGroup.tsx`, `ErrorCard.tsx`, `Home.tsx`, `ScanProgress.tsx`, `Report.tsx`, `App.tsx`, `services/api.ts`.
- **Estimated effort:** 3-4 days.
- **Dependencies:** None (frontend-only, low risk, can run in parallel with Phase 3/4 backend work).
- **Risks:** Low — mechanical extractions with visible, easily-diffed UI output.
- **Expected benefits:** Eliminates the already-observed label drift; smaller, more testable components; better failure UX.

### Phase 6 — Shared Types
- **Objectives:** H5 (add `id`/`stepIndex` to `Issue`, unify `StepResult.summary`/`ReportResponse.summary`), general backend/frontend type-drift audit.
- **Files affected:** `backend/src/types/index.ts`, `frontend/src/types/index.ts`, all sites currently using `as any` to bolt on `id`/`stepIndex` (`ScanWorker.ts`, `reports.ts`).
- **Estimated effort:** 1-2 days.
- **Dependencies:** Best done after Phase 3 (ScanWorker decomposition) so the type change and the structural change aren't conflated in one diff.
- **Risks:** Low — additive type changes; must verify no code was implicitly relying on `stepIndex`/`id` being absent from the type (unlikely, but check `tsc --noEmit` cleanly after).
- **Expected benefits:** Removes every `as any` cast at this boundary; the report API's own declared type finally matches its actual output.

### Phase 7 — Testing (interleaved, not deferred — see note above)
- **Objectives:** C4 (wire `npm test` to Jest; characterization tests for `ScanWorker`, all 9 checkers, all routes; fixture-based HTML pages for checker tests).
- **Files affected:** `backend/package.json` (test script), new tests under `backend/src/__tests__/` and co-located with `checkers/`, `frontend/` (currently zero tests — decide if in scope; recommend at minimum smoke tests for `services/api.ts` and `services/codegenConverter.ts`, which are pure logic and cheap to test).
- **Estimated effort:** 6-9 days total; front-load T02 (2-3 days) before Phase 3 and T03 (2-3 days) before Phase 4 specifically (see §5 ordering) — the remaining route/service tests can trail.
- **Dependencies:** None to start — this can and should begin immediately in Phase 1.
- **Risks:** Writing tests for Playwright-driven code requires either real browser fixtures (slow, more realistic) or mocking the `Page` object (fast, less realistic) — recommend a small number of real-browser fixture tests for the checkers (they're the highest-value, most reusable) plus mocked-Page unit tests for `ScanWorker`'s orchestration logic.
- **Expected benefits:** Makes every other phase safe to execute; this is the highest-leverage phase in the entire roadmap.

### Phase 8 — Production Hardening
- **Objectives:** H9 (DOM-scan round-trip reduction, careful/optional), M4 (CSS token system), M9 (proper UUID validation), L1-L9 (low-effort cleanups), operational concerns not yet covered (structured logging, health-check depth, graceful shutdown draining the queue).
- **Files affected:** Broad, low-risk, low-urgency cleanup across both `backend/` and `frontend/`.
- **Estimated effort:** Ongoing/opportunistic — not a single block.
- **Dependencies:** Should follow Phases 1-7 (this is genuine polish, not foundational work).
- **Risks:** Low individually; H9 specifically should only be attempted with full checker test coverage in place (Phase 7) since it changes *how* data is collected, not just how it's organized.
- **Expected benefits:** Rounds out the "enterprise-grade" bar — consistent visual system, faster scans, cleaner shutdown behavior.

---

## 5. Execution Order

Ordered, independently-executable checklist. Priority: **P0** (blocking/critical) → **P3** (nice-to-have). Difficulty: **S**mall / **M**edium / **L**arge.

| ID | Title | Priority | Dependencies | Difficulty | Est. Duration | Expected Impact |
|---|---|---|---|---|---|---|
| T01 | Wire `npm test` to actually run Jest in `backend/package.json` | P0 | None | S | 15 min | Unblocks all future safe refactoring |
| T02 | Write characterization tests for `ScanWorker.processScanJob` (mocked Playwright `Page`/`Browser`) covering: normal mode, flow mode, anti-bot classification branch | P0 | T01 | L | 2-3 days | Safety net for Phase 3 (the highest-risk refactor) |
| T03 | Write fixture-based tests for each of the 9 checkers (static HTML fixtures + real Playwright page) | P0 | T01 | L | 2-3 days | Safety net for Phase 4; also documents actual current behavior |
| T04 | Decide and document the worker/API process model (single-process vs. real isolation) — resolves C1 | P0 | None | S (decision) | 0.5 day | Removes the single biggest doc/reality mismatch |
| T05 | Implement T04's decision in `server.ts`/`workers/*` | P0 | T04 | M | 1-2 days | Architecture now matches documentation |
| T06 | Delete dead Prisma/BullMQ/Redis files and package.json entries (C5) | P0 | None | S | 2 hours | Removes confusion, shrinks install |
| T07 | Rewrite `README.md` to match actual stack (C6) | P0 | T05, T06 | S | 1 hour | Correct onboarding |
| T08 | Add PENDING/RUNNING scan recovery-on-boot logic (C3) | P0 | T05 | M | 0.5 day | Closes crash-data-loss gap |
| T09 | Add API-key auth middleware on `/api/*` (C2, partial) | P0 | None | M | 1 day | Closes unauthenticated-access gap |
| T10 | Add SSRF denylist (resolve-then-check private IP ranges) before `page.goto()` (C2, partial) | P0 | None | M | 1 day | Closes SSRF gap |
| T11 | Add rate limiting to `POST /api/scan` (H4) | P1 | None | S | 2 hours | Prevents resource-exhaustion abuse |
| T12 | Extract `FlowStepSchema`/scan-request zod schema to a shared module; use it in both `scan.ts` and `flows.ts` (H8, part 1) | P1 | None | S | 2 hours | Consistent validation |
| T13 | Add `else` branch in `ScanWorker`'s step executor to record `FLOW_ERROR` for unrecognized/malformed steps (H8, part 2) | P1 | T02, T12 | S | 2 hours | Eliminates silent-no-op correctness bug |
| T14 | Extract `FlowEngine`, `CheckerRunner`, `ScreenshotService`, `VisualRegressionService` from `ScanWorker.ts` (H1) | P1 | T02 | L | 3-4 days | Eliminates the god-function and its duplicated branches |
| T15 | Add versioned migration tracking to `database/db.ts` (H6) | P1 | None | M | 1 day | Removes fragile error-string-matching idempotency |
| T16 | Introduce `checkers/severity.ts` shared policy module; migrate all 9 checkers to use it with byte-identical output (H2) | P1 | T03 | M | 1-2 days | Consistent, centrally-tunable severity |
| T17 | Extract shared DOM-scan helpers for visibility/selector/dedup idioms across checkers (M5) | P2 | T03, T16 | M | 1-2 days | Reduces checker duplication |
| T18 | Standardize checker internal error-handling policy (remove redundant `AccessibilityChecker` try/catch or add to all) (M6) | P2 | T03 | S | 1 hour | Consistent defensive-programming policy |
| T19 | Create shared `frontend/src/config/issueTypeConfig.ts` + `scanStatusConfig.ts`; replace the 3 drifted copies each (H3) | P1 | None | M | 1 day | Fixes visible label-drift bug, prevents recurrence |
| T20 | Wire `ErrorBoundary` at `App.tsx` root (M7) | P1 | None | S | 15 min | Prevents blank-screen crashes outside `ReportViewer` |
| T21 | Fix `handleToggleBaseline` to avoid full page reload (M2) | P2 | None | S | 1 hour | Restores SPA UX on this action |
| T22 | Add abort/ignore guard to `Report.tsx`'s fetch effect (M3) | P2 | None | S | 30 min | Eliminates stale-response race |
| T23 | Add shared `unwrapApiError()` helper in `services/api.ts`; use across `Home.tsx`/`Report.tsx`/`ErrorCard.tsx` (M8) | P2 | None | S | 2 hours | Consistent error UX |
| T24 | Add `id: string`, `stepIndex?: number` to backend `Issue` type; remove all `as any` bolt-ons (H5) | P1 | T14 | S | 2 hours | Type-safety at a core boundary |
| T25 | Unify `StepResult.summary`/`ReportResponse.summary` to one enum-keyed `Summary` type (H5) | P2 | T24 | S | 1 hour | Type consistency |
| T26 | Add CSP meta tag to `frontend/index.html`; evaluate proxying Groq calls through backend (H7) | P2 | None (proxy option needs T09) | M | 1 day (meta-only) / 1-2 days (proxy) | Reduces API-key exfiltration blast radius |
| T27 | Introduce CSS custom properties in `index.css` matching documented token table; migrate components incrementally (M4) | P3 | None | L | Ongoing, ~2-3 days total | Enables single-point theming, removes hardcoded-hex sprawl |
| T28 | Fix naive UUID regex validation in `server.ts` (M9) | P3 | None | S | 30 min | Tighter validation |
| T29 | Remove dead-code null branch in `getScanQueue()`/`scan.ts` (L1) | P3 | None | S | 15 min | Code clarity |
| T30 | Extract `<StepField>` sub-component in `FlowEditor.tsx` (L2) | P3 | None | S | 1 hour | Reduces JSX duplication |
| T31 | Centralize screenshot URL construction (L3) | P3 | None | S | 30 min | Single point of change |
| T32 | Gate/remove verbose debug logging in `Report.tsx` (L4) | P3 | None | S | 15 min | Cleaner production logs |
| T33 | (Optional, high-risk) Introduce shared `PageFacts` DOM pre-pass to reduce 16 evaluate round-trips to fewer (H9) | P3 | T03, T14, T16, T17 | L | 2-3 days | Measurable scan-speed improvement (high finding-severity, but deliberately last: highest regression risk per unit of benefit) |
| T34 | Add structured logging + graceful shutdown (drain queue before exit) | P3 | T05 | M | 1 day | Operational maturity |
| T35 | Fix broken scan-progress visibility: expose the active job from the queue, or persist progress to the `scans` row (H10) | P1 | T04 (fix must match the chosen process model) | S-M | 0.5-1 day | Restores a shipped, documented feature (phase labels + per-step flow progress) that currently never displays |
| T36 | Make `PageAnalyzer.close()` close the browser context, not just the page (L7) | P3 | None | S | 15 min | Self-contained analyzer lifecycle; prevents a future leak if browsers are ever reused |
| T37 | Validate/clamp pagination params in `reports.ts` (L8) | P3 | None | S | 30 min | 400 instead of 500 on malformed query params |
| T38 | Stabilize `Home.tsx` polling effect deps (L9) | P3 | None | S | 30 min | Removes per-tick interval churn |

---

## 6. Things That MUST NOT Be Changed

The goal of every phase above is implementation quality, not product behavior. The following must remain byte-for-byte or pixel-for-pixel identical unless a task *explicitly* says otherwise:

- **Checker detection logic and output**: which issues each of the 9 checkers finds, their `type`/`severity`/`description`/`metadata` values, for any given input page. Refactors (H2, H9, M5, M6) must be verified against T02/T03's characterization tests to confirm zero behavioral drift.
- **The `page.evaluate()` template-string IIFE + `var`/`function`-only convention.** This is a hard runtime constraint (tsx/esbuild's `__name` injection), not a style preference — violating it breaks checkers in the browser context, full stop.
- **Public API contracts**: request/response shapes of `POST /api/scan`, `GET /api/scan/:id/status`, `GET /api/reports`, `GET /api/reports/:id`, `GET/POST/PUT/DELETE /api/flows*`, `POST /api/scans/:id/set-baseline`, `GET /screenshots/:scanId/:filename`. Type-safety fixes (H5) must be *additive* only.
- **Visual regression behavior**: baseline-selection logic (manual > automatic-latest), pixelmatch threshold semantics, element-matching-by-selector-then-fallback-to-type+url logic, and the "best-effort, never fails the scan" guarantee (`ScanWorker.ts:74-198`).
- **Flow execution semantics**: the supported action set (`navigate`, `click`, `type`, `wait`, `select`, `hover`, `press`, `checkpoint`), checkpoint-triggering rules (checkpoint step, navigate step, or last step), and per-step network/console event reset-on-navigate/accumulate-otherwise behavior.
- **Report compatibility**: existing scans/reports already persisted in `backend/data/sitesentry.db` must remain readable after any schema-migration-tracking change (H6/T15) — the migration-tracking table must be introduced additively, not as a destructive schema reset.
- **Screenshot file naming/paths on disk** (`data/screenshots/{scanId}/{full,diff-full,step-N-full,step-N-{issueId},{issueId},diff-{issueId}}.png`) — the frontend and DB both reference these paths; any change must be coordinated across all three.
- **The current UI/UX behavior of every existing feature** (score calculation, filters, grouping, JSON/CSV export format, flow editor codegen parsing) unless a specific Medium/Low finding above explicitly targets it (e.g., T21's baseline-reload fix changes *mechanism*, not *outcome*).
- **All user-facing text remains in Spanish.**
- **The anti-bot HTTP/2-block-to-issue classification** (`ScanWorker.ts:513-552`) and its exact issue shape.

**Clarification on H10/T35:** fixing the progress display is *not* a violation of this section. The progress feature is documented (`CLAUDE.md`: "GET status with per-step progress") and has a complete UI (`ScanProgress.tsx` phase labels) — it is broken, not absent by design. Restoring documented intended behavior is a repair, and the `GET /api/scan/:id/status` response shape (`progress` field) stays contract-identical; it just stops being permanently `null`.

---

## 7. Future Architecture Vision

### 7.1 Module organization (target end-state)

```
backend/src/
  api/
    routes/            (thin — validate via shared zod schemas, delegate to services)
    middleware/         (NEW: auth, rate-limit, error handler)
  services/             (NEW — extracted from ScanWorker.ts)
    FlowEngine.ts
    CheckerRunner.ts
    ScreenshotService.ts
    VisualRegressionService.ts
    ScanOrchestrator.ts  (thin coordinator, replaces processScanJob's current god-role)
  checkers/
    severity.ts          (NEW — shared severity policy module)
    domHelpers.ts         (NEW — shared evaluate-string builders, where safe)
    *.ts                  (9 checkers, now composing severity.ts/domHelpers.ts)
  analyzer/
    PageAnalyzer.ts        (unchanged — already well-scoped)
  database/
    db.ts
    migrations/            (NEW — numbered, tracked migration files)
  queue/
    queue.ts                (unchanged interface; internals depend on T04's decision)
  types/
    index.ts                 (Issue/ReportResponse gaps closed — H5)
  config.ts                  (either deleted or made the single real config source — not both)

frontend/src/
  config/                    (NEW — issueTypeConfig.ts, scanStatusConfig.ts, severityConfig.ts)
  utils/                     (NEW — report.ts: export/format/score logic extracted from ReportViewer.tsx)
  services/
    api.ts                    (adds unwrapApiError, screenshot URL helper)
  ...                          (component tree otherwise unchanged — it's reasonably well-organized already)
```

### 7.2 Dependency graph (target)

`routes → services (ScanOrchestrator) → {FlowEngine, CheckerRunner, ScreenshotService, VisualRegressionService} → {checkers/*, analyzer/PageAnalyzer, database/db}`. No layer reaches back upward; `checkers/*` remain leaf-level, depending only on `types` and `severity.ts`/`domHelpers.ts`. This is the same dependency direction that already exists informally today — the vision is making it *explicit* via real module boundaries instead of one flat file.

### 7.3 Communication flow (target, assuming T04 chooses real process isolation)

```
Frontend → API process (auth + rate-limit + validate + enqueue) → durable queue
   → Worker process (only process that imports ScanOrchestrator) → SQLite (shared file, WAL mode already enabled)
```
If T04 instead chooses to formalize single-process (the lower-effort, still-legitimate option), the vision simplifies to: `Frontend → API process (auth + rate-limit + validate + enqueue + process, honestly documented as one process) → SQLite`. Either is acceptable; what's not acceptable is the current state where the code says one thing and the docs say another.

### 7.4 Scalability model

- **Today's ceiling**: one Chromium instance processed at a time, single process, single SQLite file — fine for a small team's internal QA tool, not fine for a shared multi-tenant service.
- **Next tier** (if ever needed): SQLite's WAL mode already supports concurrent readers; the queue could be swapped for a durable store (even a simple `scans`-table-as-queue poll, avoiding reintroducing Redis/BullMQ unless genuinely needed) enabling multiple worker processes to safely claim jobs (`UPDATE ... SET status='RUNNING' WHERE status='PENDING' AND id=? ...` with a unique claim check).
- Horizontal scaling of *workers* (multiple Chromium-running processes) is the natural next lever once T04/T05 establish real process boundaries; horizontal scaling of the *API* is already trivially possible once the queue is durable and shared (it already isn't tied to in-memory API state for anything except the queue itself).

### 7.5 Extensibility model

- **Checkers**: already a strong extension point (§2.5); the vision preserves the "just add a class + register it" simplicity while removing the current 3-file frontend-label-sync tax (via `config/issueTypeConfig.ts` from T19) and the severity-inconsistency tax (via `severity.ts` from T16).
- **Flow actions**: currently a closed `if/else-if` chain in `ScanWorker.ts`; a small action-registry (`Record<string, StepExecutor>`) would let new actions be added the same low-friction way checkers already are, and naturally fixes H8's silent-no-op problem (an unregistered action key is trivially detectable).

### 7.6 Maintainability improvements

- One severity policy instead of five.
- One label/config source instead of three per enum.
- One config module (or none, if truly unnecessary) instead of one dead one and scattered `process.env` reads.
- One documented, true worker/API model instead of a documented-but-fictional one.
- Real test coverage turning every future change here from "hope it still works" into "the tests will tell you."

This is not a rewrite. Every recommendation above is a targeted, behavior-preserving improvement to an already-functional, feature-rich product — the checker plugin architecture, the visual regression math, and the anti-bot handling are all genuinely well-built and should be the model the rest of the codebase is brought up to, not replaced.
