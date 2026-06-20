# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SiteSentry QA is a single-page functional web analyzer. Given one URL, it opens that page in a headless browser, intercepts network traffic, scrolls through the page, and runs 9 checkers to detect functional and quality problems. It does NOT crawl or follow links.

Supports interactive multi-step flows (login, search, add to cart) via JSON step definitions or Playwright codegen script import. Includes visual regression detection comparing screenshots between scans of the same URL using pixelmatch. All user-facing text is in Spanish.

## Commands

### Backend (from `backend/`)
- `npm run dev` — Start API server with tsx watch (hot reload, port 3001)
- `npm run dev:worker` — Start BullMQ worker with tsx watch
- `npm run build` — TypeScript compile (`tsc`)
- `npx tsc --noEmit` — Type-check without emitting
- `npx jest --no-coverage` — Run test suite

### Frontend (from `frontend/`)
- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Type-check + Vite production build
- `npm run lint` — ESLint

### Running the app requires 3 terminals
1. `cd backend && npm run dev` (API on port 3001)
2. `cd backend && npm run dev:worker` (BullMQ worker, requires Redis)
3. `cd frontend && npm run dev` (Vite on port 5173)

## Architecture

### Full Pipeline
`POST /api/scan` → SQLite creates Scan row → BullMQ job queued → Worker picks up job → Playwright opens page → [Flow mode: execute steps (click, type, navigate...)] → PageAnalyzer intercepts network + scrolls → 9 Checkers run (per step in flow mode) → Issues + screenshots saved (per step in flow mode) → Visual regression diff vs baseline (pixelmatch) → Frontend polls `/api/scan/:id/status` until COMPLETED → Fetches `/api/reports/:id`

### Backend Key Files
- **`src/analyzer/PageAnalyzer.ts`** — Core engine. Creates a BrowserContext with a realistic fingerprint (userAgent, locale, Sec-CH-UA headers), intercepts all network requests/responses/failures, captures console errors, performs full-page scroll. Returns `PageAnalysis` with `page`, `NetworkEvent[]`, `ConsoleEvent[]`, `loadTime`, `scrollHeight`.
- **`src/checkers/`** — 9 checkers, each implements `IChecker.check(url, page, networkEvents, consoleErrors?)`. See checkers section below.
- **`src/workers/ScanWorker.ts`** — Orchestrates the full pipeline: launch browser → analyze → [flow steps] → run checkers (per step in flow mode, passing `analysis.consoleErrors` as 4th arg) → capture screenshots (per step in flow mode) → run visual regression (pixelmatch) → save issues. Anti-bot blocks saved as `FAILED_API/HIGH` issue instead of failing.
- **`src/api/routes/scan.ts`** — POST scan (accepts `flow`, `flowId`, `visualDiffThreshold`), GET status with per-step progress.
- **`src/api/routes/reports.ts`** — GET report (includes `fullPageScreenshot`, `screenshot_path` per issue, `visualDiffs[]`, `baselineInfo`, `flow`, per-step `steps[]` with summaries and screenshots), GET all reports list.
- **`src/api/routes/flows.ts`** — CRUD for reusable interactive flows: `GET /api/flows`, `GET /api/flows/:id`, `POST /api/flows`, `PUT /api/flows/:id`, `DELETE /api/flows/:id`.
- **`src/api/server.ts`** — Express app. Routes: `/api/scan`, `/api/reports`, `/api/flows`, `/screenshots/:scanId/:filename` (serves PNG files with path traversal protection and UUID validation), `/api/scans/:id/set-baseline` (marks/unmarks manual baseline).
- **`src/types/index.ts`** — Shared enums (`IssueType`, `IssueSeverity`, `ScanStatus`), interfaces (`Issue`, `IChecker`, `VisualDiff`, `BaselineInfo`, `FlowStep`, `FlowInfo`, `StepResult`, `ReportResponse`, `ScanConfig`).
- **`src/database/db.ts`** — SQLite schema via `better-sqlite3`. Tables: `scans`, `issues`, `visual_diffs`, `flows`. Migrations via inline `ALTER TABLE`/`CREATE TABLE` with try/catch for idempotency.

### Dependencies (backend)
- **Runtime:** `express`, `cors`, `helmet`, `playwright`, `better-sqlite3`, `bullmq`, `ioredis`, `zod`, `pixelmatch`, `pngjs`, `sharp`, `@axe-core/playwright`, `@prisma/client`
- **Dev:** `typescript`, `tsx`, `@types/express`, `@types/cors`, `@types/node`, `@types/better-sqlite3`, `@types/jest`, `@types/pngjs`, `prisma`

### Checkers (9)
| Checker | IssueType | Detecta |
|---|---|---|
| BrokenResourcesChecker | `BROKEN_RESOURCE` | Imagenes/CSS/scripts/fonts rotos (network + DOM) |
| FailedAPIChecker | `FAILED_API` | XHR/fetch con error, APIs lentas >10s, CORS |
| InteractivityChecker | `INTERACTIVITY` | Links sin href, placeholders `#`, botones sin `disabled` |
| ContentChecker | `EMPTY_CONTENT` | Contenedores vacios, mensajes de error visibles |
| LazyLoadChecker | `LAZY_LOAD` | Imagenes lazy no cargadas, spinners atascados |
| FormModalChecker | `FORM_MODAL` | Forms sin submit/action, modales sin cierre, banners cookie |
| ConsoleErrorChecker | `CONSOLE_ERROR` | JS errors, CORS errors (usa 4o param `consoleErrors`) |
| PerformanceChecker | `PERFORMANCE` | TTFB, DOMContentLoaded, full load, DOM nodes, resource count |
| AccessibilityChecker | `ACCESSIBILITY` | Violaciones WCAG 2.0A/AA/2.1A/AA via `@axe-core/playwright` |

Additional `IssueType.FLOW_ERROR` (severity HIGH) is generated by ScanWorker (not a checker) when a flow step fails to execute.

### Issue Types Reference
| Type | Severity | Source | Description |
|------|----------|--------|-------------|
| `BROKEN_RESOURCE` | HIGH/MEDIUM | BrokenResourcesChecker | Broken images, CSS, scripts, fonts |
| `FAILED_API` | HIGH/MEDIUM | FailedAPIChecker | Failed API calls, CORS, slow APIs |
| `INTERACTIVITY` | MEDIUM/LOW | InteractivityChecker | Broken links, disabled buttons |
| `EMPTY_CONTENT` | HIGH | ContentChecker | Empty containers, error messages |
| `LAZY_LOAD` | HIGH/MEDIUM | LazyLoadChecker | Lazy images, stuck spinners |
| `FORM_MODAL` | MEDIUM | FormModalChecker | Form/modal issues |
| `CONSOLE_ERROR` | HIGH/MEDIUM | ConsoleErrorChecker | JS errors, console errors |
| `PERFORMANCE` | HIGH/MEDIUM/LOW | PerformanceChecker | Page performance metrics |
| `ACCESSIBILITY` | HIGH/MEDIUM/LOW | AccessibilityChecker | WCAG violations |
| `FLOW_ERROR` | HIGH | ScanWorker | Flow step execution failure |

### Frontend Key Files
- **`src/pages/Home.tsx`** — URL input + flow selector dropdown + "Nuevo flujo" button + FlowEditor modal + scan progress polling.
- **`src/pages/Report.tsx`** — Fetches and displays report.
- **`src/components/ReportViewer/ReportViewer.tsx`** — Score, FlowTabs (per-step views when flow exists), filters, grouping by type, JSON/CSV export, full-page screenshot, visual regression section (VisualDiffViewer + baseline toggle). Contains `getTypeLabel()` and `getTypeIcon()`.
- **`src/components/ErrorGroup/ErrorGroup.tsx`** — Group header per IssueType. Contains `typeConfig` with label, icon and color per type. Accepts `visualDiffsMap` to pass element diffs to ErrorCard. **Must be updated when adding new IssueType.**
- **`src/components/ErrorCard/ErrorCard.tsx`** — Individual issue card with formatted metadata, element screenshot (ScreenshotThumb), element visual diff (VisualDiffViewer compact), copy-to-clipboard and AI explain buttons. Contains `typeConfig`. **Must be updated when adding new IssueType.**
- **`src/components/ScreenshotThumb/ScreenshotThumb.tsx`** — Lazy-loaded thumbnail with loading/error states. Click opens Lightbox.
- **`src/components/Lightbox/Lightbox.tsx`** — Full-screen image modal with ESC/click-to-close, body scroll lock.
- **`src/components/VisualDiffViewer/VisualDiffViewer.tsx`** — Side-by-side slider comparing baseline vs current screenshot, diff.png overlay, percentage badge (red if over threshold, green if under). Supports compact mode for element diffs.
- **`src/components/FlowEditor/FlowEditor.tsx`** — Flow editor with textarea for Playwright codegen paste, "Convertir" button (calls `parseCodegenScript`), editable step list with per-action fields, add/delete steps, save via API. Opens as modal from Home.tsx.
- **`src/components/FlowTabs/FlowTabs.tsx`** — Horizontal tab bar for per-step navigation in reports. Each tab shows icon + label + issue count badge. Includes "Resumen" tab for combined view.
- **`src/components/Settings/Settings.tsx`** — LLM configuration (Groq API key, model selection).
- **`src/services/api.ts`** — Axios client hitting backend on port 3001. Methods: `startScan`, `getScanStatus`, `getReport`, `getReports`, `setBaseline`, `getFlows`, `getFlow`, `createFlow`, `updateFlow`, `deleteFlow`.
- **`src/services/ai.ts`** — Groq LLM integration for explaining issues. Reads API key and model from localStorage.
- **`src/services/codegenConverter.ts`** — Parses Playwright codegen scripts to `FlowStep[]` via regex. Supports goto, click, fill, waitForTimeout, selectOption, hover, press.
- **`src/types/index.ts`** — Frontend mirrors of backend enums/interfaces. Includes `VisualDiff`, `BaselineInfo`, `FlowStep`, `FlowInfo`, `FlowDefinition`, `StepResult`. `Issue` includes `id?`, `screenshot_path?`, `stepIndex?`. `ReportResponse` includes `fullPageScreenshot?`, `visualDiffs[]`, `baselineInfo`, `flow?`, `steps?`.

## Screenshots (Phase 1 — Complete)

After checkers run and before closing the page, ScanWorker captures:
- **Full-page screenshot** → `data/screenshots/{scanId}/full.png`
- **Element screenshots** → `data/screenshots/{scanId}/{issueId}.png` for HIGH severity issues with a CSS `selector` in metadata
- **Per-step screenshots** (flow mode) → `data/screenshots/{scanId}/step-{N}-full.png` and `data/screenshots/{scanId}/step-{N}-{issueId}.png`

Screenshots served via `GET /screenshots/:scanId/:filename` (with UUID validation and path traversal protection). Frontend displays them via `ScreenshotThumb` + `Lightbox` components in ErrorCard dropdowns and ReportViewer header.

Key types: `Issue.screenshot_path?: string`, `ReportResponse.fullPageScreenshot?: string | null`.

## Visual Regression (Phase 2 — Complete)

After screenshots and issue persistence, ScanWorker runs `runVisualRegression()`:
- **Baseline lookup**: manual (`is_baseline=1`) takes priority, then automatic (last completed scan of same URL). Skip if no baseline exists.
- **Full-page diff**: loads `full.png` from both scans, resizes to smallest common dimensions via `sharp`, runs `pixelmatch`, saves `diff-full.png`, stores metrics in `visual_diffs` table.
- **Element diffs**: for each HIGH issue with screenshot, matches by CSS selector (exact string), falls back to same IssueType + same URL. Diffs per-element screenshots, saves `diff-{issueId}.png`.
- **Threshold**: `VISUAL_DIFF_THRESHOLD` env var (default 0.05), overridable per scan via `visualDiffThreshold` param in POST body.
- **Best-effort**: diff failures never fail the scan. Each diff operation wrapped in try/catch.
- **Baseline management**: `POST /api/scans/:id/set-baseline` marks/unmarks a scan as manual baseline. `is_baseline` column on `scans` table. Only one manual baseline per URL.

**Frontend**: `VisualDiffViewer` component with interactive side-by-side slider (range input overlaid on CSS-clipped images), diff.png with highlighted pixels, percentage badge (red if > threshold, green if ≤ threshold). Full-page diffs shown in ReportViewer visual regression section; element diffs shown in ErrorCard details (compact mode, diff.png only).

**DB**: `visual_diffs` table with `diff_type` (full_page/element), `diff_percentage`, `diff_image_path`, `baseline_issue_id`, `element_identifier`.

## Interactive Flows (Phase 3 — Complete)

Users can define multi-step flows to test interactive workflows (login, search, add to cart).

### Flow Definition Format
```json
[
  { "action": "navigate", "url": "https://example.com/login" },
  { "action": "type", "selector": "#username", "value": "admin" },
  { "action": "type", "selector": "#password", "value": "pass123" },
  { "action": "click", "selector": "button[type=submit]" },
  { "action": "wait", "ms": 2000 },
  { "action": "checkpoint" }
]
```

**Supported actions:** `navigate` (url), `click` (selector), `type` (selector, value), `wait` (ms), `select` (selector, value), `hover` (selector), `press` (key, optional selector), `checkpoint` (triggers checkers + screenshot at this point).

### Flow Storage and API
- **`flows` table**: id, name, steps (JSON), created_at, updated_at
- **CRUD**: `GET /api/flows`, `GET /api/flows/:id`, `POST /api/flows`, `PUT /api/flows/:id`, `DELETE /api/flows/:id`
- **Scan integration**: `POST /api/scan` accepts `flow` (inline steps) or `flowId` (saved reference). Inline takes priority. Worker receives resolved `config.flow = { name, steps }`.
- **GET /api/reports/:id**: returns `flow` (step definitions) and `steps[]` (per-step results with issues, summaries, screenshots).

### Flow Execution (ScanWorker)
1. For each step: execute action (click/type/navigate/wait/select/hover/press). On failure: register `FLOW_ERROR` and continue (or abort on navigate failure).
2. At checkpoints + navigations + last step: run fullPage scroll, run all 9 checkers, capture per-step screenshots (`step-{N}-full.png`, `step-{N}-{issueId}.png`). Issues get `step_index`.
3. Network/console events: reset on navigate steps, accumulate on non-navigate steps. Listeners attached once (not per navigate) to avoid quadratic duplication.
4. After flow: assign UUIDs to all issues, copy last step's `full.png` for visual regression compatibility.
5. **`step_index` column** on `issues` table: NULL for normal scans, 0/1/2... for flow steps.

### Codegen Import
`frontend/src/services/codegenConverter.ts` parses Playwright codegen scripts via regex:
- `page.goto('url')` → navigate
- `page.click('selector')` → click
- `page.fill('selector', 'value')` → type
- `page.waitForTimeout(ms)` → wait
- `page.selectOption('selector', 'value')` → select
- `page.hover('selector')` → hover
- `page.press('selector', 'key')` → press
- Auto-adds final `checkpoint` step.

### Frontend Flow UI
- **FlowEditor**: textarea for codegen paste + "Convertir" button, editable step list with action selector and per-action fields, add/delete steps, save flow via API. Opens as modal from Home page.
- **Home.tsx**: flow selector dropdown (saved flows), "Nuevo flujo" button (opens FlowEditor), passes `flow`/`flowId` in `startScan()`.
- **FlowTabs**: horizontal tab bar rendered at top of ReportViewer when `report.flow` exists. One tab per step + "Resumen" tab. Click filters issues by `stepIndex`.
- **ReportViewer**: per-step screenshot display, per-step filtering, visual regression section in Resumen tab.

## Critical: page.evaluate and tsx/esbuild

All `page.evaluate()` calls **must** use template string format:
```typescript
await page.evaluate(`(() => { ... })()`)
```
Never use arrow function callbacks. The tsx runner (esbuild) injects a `__name` helper that causes `ReferenceError: __name is not defined` in the browser context. Use `var`, `function`, and `for` loops inside evaluate strings — no `const`/`let`/arrow functions.

**This constraint applies ONLY to `page.evaluate()` strings**, not to regular TypeScript/Node.js code or frontend React code.

## Database

SQLite via `better-sqlite3`. The database file is at `backend/data/sitesentry.db` (configurable via `DB_PATH` env var). Schema is auto-created in `db.ts` with `CREATE TABLE IF NOT EXISTS`. Migrations are run inline as `ALTER TABLE`/`CREATE TABLE` statements with try/catch for idempotency.

Tables:
- **`scans`** — id, url, status, config, is_baseline, created_at, completed_at
- **`issues`** — id, scan_id, type, severity, url, source_url, description, metadata, screenshot_path, step_index, created_at
- **`visual_diffs`** — id, scan_id, baseline_scan_id, diff_type, issue_id, baseline_issue_id, element_identifier, diff_percentage, diff_image_path, threshold_used, created_at
- **`flows`** — id, name, steps, created_at, updated_at

## Adding a New Checker

1. Add new value to `IssueType` enum in:
   - `backend/src/types/index.ts`
   - `frontend/src/types/index.ts`
2. Create `backend/src/checkers/MyChecker.ts` implementing `IChecker`
3. Export and register in `backend/src/checkers/index.ts`
4. Add label + icon to `getTypeIcon()`/`getTypeLabel()` in `ReportViewer.tsx`
5. Add entry to `typeConfig` in `ErrorGroup.tsx` (label, icon, color)
6. Add entry to `typeConfig` in `ErrorCard.tsx` (label, icon)

## Anti-Bot Handling

Browser launches with `--disable-http2` (force HTTP/1.1). PageAnalyzer uses a realistic Chrome fingerprint: userAgent, locale `es-ES`, timezone `Europe/Madrid`, `Sec-CH-UA`/`Accept-Language` headers. If blocked, ScanWorker saves a `FAILED_API/HIGH` issue with `metadata.errorType: 'ANTI_BOT_BLOCK'` and marks scan COMPLETED.

## Report Export

ReportViewer has JSON and CSV download buttons. JSON exports full report with Spanish labels. CSV includes BOM for Excel compatibility with dynamic metadata columns. Files named `reporte_qa_{hostname}_{date}.{ext}`.

## UI Language

All user-facing text is in **Spanish**. Issue descriptions, checker output, frontend copy, flow step labels, and diff labels are all in Spanish.

## Key Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| `PORT` | `3001` | Backend API port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowed origin |
| `DB_PATH` | `./data/sitesentry.db` | SQLite database path |
| `PAGE_TIMEOUT` | `60000` | Page load timeout (ms) |
| `VISUAL_DIFF_THRESHOLD` | `0.05` | pixelmatch threshold (0-1) |
| `REDIS_URL` | (BullMQ default) | Redis connection for queue |
| `DATABASE_URL` | — | PostgreSQL URL for Prisma (scan route) |
